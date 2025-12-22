"use strict";

const { pool } = require("../db/pool");

async function apiAuth(req, res, next) {
  try {
    const auth = req.header("Authorization") || "";
    const token = auth.replace("Bearer ", "").trim();

    if (!token) {
      return res.status(401).json({ error: "Missing API token" });
    }

    const result = await pool.query(
      "SELECT id FROM users WHERE api_key = $1 LIMIT 1;",
      [token]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: "Invalid API token" });
    }

    req.user = { id: result.rows[0].id };
    next();
  } catch (err) {
    console.error("Error in apiAuth middleware:", err);
    res.status(500).json({ error: "Auth error" });
  }
}

module.exports = { apiAuth };
