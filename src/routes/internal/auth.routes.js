"use strict";

const express = require("express");
const bcrypt = require("bcrypt");
const { pool } = require("../../db/pool");

const router = express.Router();

const crypto = require("crypto");
const { sendPasswordResetEmail, sendVerificationEmail } = require("../../clients/mailgun");


// who am I? (used by UI + Postman to check login)
router.get("/me", async (req, res) => {
  if (!req.session?.userId) {
    return res.json({ user: null });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        u.id,
        u.email, u.carrier_limit, 
        u.view_insurance, u.email_alerts, u.send_contracts,
        uc.carrier_count
      FROM users u
      LEFT JOIN (select count(carrier_dot) carrier_count, user_id from user_carriers group by user_id) uc
      ON u.id = uc.user_id
      WHERE id = $1
      LIMIT 1
      `,
      [req.session.userId]
    );

    if (!rows.length) {
      return res.json({ user: null });
    }

    return res.json({ user: rows[0] });
  } catch (err) {
    console.error("GET /api/me failed:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// login: expects { "email": "x", "password": "y" }
router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password required" });
  }

  try {
    const result = await pool.query(
      "SELECT id, password_hash FROM users WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // success → set session
    req.session.userId = user.id;
    res.json({ ok: true });
  } catch (err) {
    console.error("Error in POST /api/login:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// change password (must be logged in)
// expects { currentPassword, newPassword }
router.post("/change-password", async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword and newPassword required" });
  }

  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  try {
    const userId = req.session.userId;

    const result = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const ok = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!ok) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    const nextHash = await bcrypt.hash(newPassword, 12);

    await pool.query(
      "UPDATE users SET password_hash = $1 WHERE id = $2",
      [nextHash, userId]
    );

    // optional hardening: rotate session ID after password change
    if (typeof req.session.regenerate === "function") {
      const prev = userId;
      return req.session.regenerate((err) => {
        if (err) {
          console.error("session regenerate failed:", err);
          return res.json({ ok: true });
        }
        req.session.userId = prev;
        return res.json({ ok: true });
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Error in POST /api/change-password:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// Functions for Password Resets

function makeResetToken() {
  return crypto.randomBytes(32).toString("hex"); // 64 chars
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// POST /api/forgot-password  { email }
// Always returns ok:true to prevent account enumeration.
router.post("/forgot-password", async (req, res) => {
  const emailRaw = String(req.body?.email || "").trim().toLowerCase();
  if (!emailRaw) return res.json({ ok: true });

  try {
    const { rows } = await pool.query(
      "SELECT id, email FROM users WHERE lower(email) = $1 LIMIT 1",
      [emailRaw]
    );

    if (rows.length === 0) {
      // don't reveal whether account exists
      return res.json({ ok: true });
    }

    const user = rows[0];

    const token = makeResetToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 60 minutes

    await pool.query(
      `
      INSERT INTO public.password_reset_tokens
        (user_id, token_hash, expires_at, request_ip, user_agent)
      VALUES
        ($1, $2, $3, $4, $5)
      `,
      [
        user.id,
        tokenHash,
        expiresAt.toISOString(),
        req.ip || null,
        req.get("user-agent") || null,
      ]
    );

    const link = `https://carriershark.com/reset-password/${token}`;

    // send email (if Mailgun fails, we still return ok:true)
    try {
      await sendPasswordResetEmail({ to: user.email, link });
    } catch (e) {
      console.error("sendPasswordResetEmail failed:", e?.message || e);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("Error in POST /api/forgot-password:", err);
    // still ok:true so attackers can't distinguish errors vs no-account
    return res.json({ ok: true });
  }
});

// POST /api/reset-password  { token, newPassword }
// On success: updates hash, marks token used, logs user in (session), returns ok:true
router.post("/reset-password", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const newPassword = String(req.body?.newPassword || "");

  if (!token) return res.status(400).json({ error: "Missing token" });
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const tokenHash = hashToken(token);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      SELECT prt.id AS reset_id, prt.user_id
      FROM public.password_reset_tokens prt
      WHERE prt.token_hash = $1
        AND prt.used_at IS NULL
        AND prt.expires_at > now()
      LIMIT 1
      FOR UPDATE
      `,
      [tokenHash]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Invalid or expired reset link" });
    }

    const { reset_id, user_id } = rows[0];

    const nextHash = await bcrypt.hash(newPassword, 12);

    await client.query(
      "UPDATE public.users SET password_hash = $1 WHERE id = $2",
      [nextHash, user_id]
    );

    await client.query(
      "UPDATE public.password_reset_tokens SET used_at = now() WHERE id = $1",
      [reset_id]
    );

    await client.query("COMMIT");

    // Auto-login (Option B)
    if (typeof req.session.regenerate === "function") {
      return req.session.regenerate((err) => {
        if (err) {
          console.error("session regenerate failed:", err);
          req.session.userId = user_id;
          return res.json({ ok: true });
        }
        req.session.userId = user_id;
        return res.json({ ok: true });
      });
    }

    req.session.userId = user_id;
    return res.json({ ok: true });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Error in POST /api/reset-password:", err);
    return res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});


// logout
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// signup: expects form POST from create-account.html
// fields: first_name, last_name, email, company, password, password_confirm
router.post("/auth/signup", async (req, res) => {
  const firstName = String(req.body?.first_name || "").trim();
  const lastName  = String(req.body?.last_name || "").trim();
  const company   = String(req.body?.company || "").trim();
  const emailRaw  = String(req.body?.email || "").trim().toLowerCase();
  const password  = String(req.body?.password || "");
  const password2 = String(req.body?.password_confirm || "");

  if (!firstName || !lastName || !company || !emailRaw || !password || !password2) {
    return res.status(400).send("Missing required fields.");
  }
  if (password !== password2) {
    return res.status(400).send("Passwords do not match.");
  }
  if (password.length < 8) {
    return res.status(400).send("Password must be at least 8 characters.");
  }

  try {
    // ✅ IMPORTANT: treat email as case-insensitive
    const existing = await pool.query(
      `SELECT id FROM users WHERE lower(email) = $1 LIMIT 1`,
      [emailRaw]
    );


if (existing.rows.length) {
  return res.status(409).send("Account already exists. Please log in.");
}


    // Create new user
    const nextHash = await bcrypt.hash(password, 12);
      
      const created = await pool.query(
        `
        INSERT INTO users (email, password_hash, company, name)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        `,
        [
          emailRaw,
          nextHash,
          company,
          `${firstName} ${lastName}`
        ]
      );


    req.session.userId = created.rows[0].id;

    // Create + store verification token
    const userId = created.rows[0].id;
    
    const token = makeResetToken();        // random string
    const tokenHash = hashToken(token);    // SHA256(token)
    const expiresMinutes = 60;
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);
    
    await pool.query(
      `
      INSERT INTO public.email_verification_tokens
        (user_id, token_hash, expires_at, request_ip, user_agent)
      VALUES
        ($1, $2, $3, $4, $5)
      `,
      [
        userId,
        tokenHash,
        expiresAt.toISOString(),
        req.ip || null,
        req.get("user-agent") || null
      ]
    );
    
    const verifyUrl = `https://carriershark.com/verify-email/${token}`;
    
    // Send verification email (Mailgun)
    try {
      await sendVerificationEmail({
        to: emailRaw,
        first_name: firstName,
        verify_url: verifyUrl,
        expires_minutes: String(expiresMinutes),
      });
    } catch (e) {
      console.error("sendVerificationEmail failed:", e?.message || e);
      // You can still redirect to verify-email page, and let them hit "Resend"
    }

    // TODO: create email verification token + send verification email
    return res.redirect(303, "/verify-email");
  } catch (err) {
console.error("SIGNUP FAILED:", err?.message, err);
return res.status(500).json({
  error: "signup_failed",
  message: err?.message || "unknown",
  code: err?.code || null
});
  }
});


module.exports = router;
