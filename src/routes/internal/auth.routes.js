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

// logout
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

module.exports = router;
