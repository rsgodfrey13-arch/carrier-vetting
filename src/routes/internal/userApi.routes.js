"use strict";

const express = require("express");
const crypto = require("crypto");
const { pool } = require("../../db/pool");

const router = express.Router();

function requireLogin(req, res) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not logged in" });
    return false;
  }
  return true;
}

function maskKey(key) {
  if (!key) return "—";
  const s = String(key);
  if (s.length <= 8) return "••••••••";
  return `${s.slice(0, 4)}••••••••••••${s.slice(-4)}`;
}

function generateApiKey() {
  // 48 chars hex
  return crypto.randomBytes(24).toString("hex");
}

// GET /api/user/api
router.get("/user/api", async (req, res) => {
  if (!requireLogin(req, res)) return;

  try {
    const userId = req.session.userId;

    const result = await pool.query(
      "SELECT API_KEY FROM PUBLIC.USERS WHERE ID = $1",
      [userId]
    );

    const apiKey = result.rows?.[0]?.api_key || null;

    // Best practice: do NOT return the full key here.
    return res.json({
      has_key: !!apiKey,
      masked_key: maskKey(apiKey),
    });
  } catch (err) {
    console.error("Error in GET /api/user/api:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /api/user/api/rotate
router.post("/user/api/rotate", async (req, res) => {
  if (!requireLogin(req, res)) return;

  try {
    const userId = req.session.userId;
    const newKey = generateApiKey();

    const result = await pool.query(
      "UPDATE PUBLIC.USERS SET API_KEY = $1 WHERE ID = $2 RETURNING API_KEY",
      [newKey, userId]
    );

    const saved = result.rows?.[0]?.api_key || null;

    return res.json({
      masked_key: maskKey(saved),
      full_key: saved, // return once on rotate so UI can copy
    });
  } catch (err) {
    console.error("Error in POST /api/user/api/rotate:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
