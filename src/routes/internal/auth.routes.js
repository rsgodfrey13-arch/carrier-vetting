"use strict";

const express = require("express");
const bcrypt = require("bcrypt");
const { pool } = require("../../db/pool");

const router = express.Router();

// who am I? (used by UI + Postman to check login)
router.get("/me", (req, res) => {
  if (!req.session?.userId) {
    return res.json({ user: null });
  }
  res.json({ user: { id: req.session.userId } });
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


// logout
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

module.exports = router;
