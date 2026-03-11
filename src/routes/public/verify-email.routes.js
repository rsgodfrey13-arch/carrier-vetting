"use strict";

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { pool } = require("../../db/pool");

const router = express.Router();

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// PAGE: /verify-email  (shows “check your inbox / resend”)
router.get("/verify-email", (req, res) => {
  return res.sendFile(path.join(__dirname, "../../../static", "verify-email.html"));
});

// CLICKED LINK: /verify-email/:token  (verifies, then redirects)
router.get("/verify-email/:token", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.redirect(302, "/verify-email");

  const tokenHash = hashToken(token);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
      SELECT id, user_id
      FROM public.email_verification_tokens
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > now()
      LIMIT 1
      FOR UPDATE
      `,
      [tokenHash]
    );

    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.redirect(302, "/verify-email?status=invalid");
    }

    const { id: token_id, user_id } = rows[0];

    await client.query(
      `UPDATE public.users SET email_verified_at = now() WHERE id = $1`,
      [user_id]
    );

    await client.query(
      `UPDATE public.email_verification_tokens SET used_at = now() WHERE id = $1`,
      [token_id]
    );

    await client.query("COMMIT");

    // optional: log them in after verifying
    req.session.userId = user_id;

    // send them to your plan page (adjust if yours is different)
    return res.redirect(302, "/verify-email?status=verified");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("GET /verify-email/:token failed:", err?.message || err);
    return res.redirect(302, "/verify-email?status=error");
  } finally {
    client.release();
  }
});

router.post("/api/auth/resend-verification", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();

  if (!email) {
    return res.redirect(302, "/verify-email?status=missing");
  }

  const client = await pool.connect();

  try {
    const { rows } = await client.query(
      `
      SELECT id, email, email_verified_at
      FROM public.users
      WHERE lower(email) = $1
      LIMIT 1
      `,
      [email]
    );

    if (!rows.length) {
      return res.redirect(302, "/verify-email?status=sent");
    }

    const user = rows[0];

    if (user.email_verified_at) {
      return res.redirect(302, "/verify-email?status=verified");
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);

    await client.query(
      `
      INSERT INTO public.email_verification_tokens
        (user_id, token_hash, expires_at)
      VALUES
        ($1, $2, now() + interval '24 hours')
      `,
      [user.id, tokenHash]
    );

    const verifyUrl = `${req.protocol}://${req.get("host")}/verify-email/${rawToken}`;

    const { sendVerificationEmail } = require("../../lib/mailgun"); // adjust path if needed

    await sendVerificationEmail({
      to: user.email,
      verify_url: verifyUrl
    });

    return res.redirect(302, "/verify-email?status=sent");
  } catch (err) {
    console.error("POST /api/auth/resend-verification failed:", err?.message || err);
    return res.redirect(302, "/verify-email?status=error");
  } finally {
    client.release();
  }
});

module.exports = router;
