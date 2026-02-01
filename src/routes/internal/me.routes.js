"use strict";

const express = require("express");

function meRoutes({ pool }) {
  if (!pool) throw new Error("meRoutes requires pool");

  const router = express.Router();

  router.get("/me", async (req, res) => {
    // however you identify the logged-in user
    const userId = req.user?.id || req.session?.user_id;

    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { rows } = await pool.query(
      `
      SELECT
        u.email
      FROM users u
      WHERE u.id = $1
      `,
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(rows[0]);
  });

  return router;
}

module.exports = meRoutes;
