"use strict";

const express = require("express");
const router = express.Router();

// account snapshot data for Account page
router.get("/account/overview", async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const userId = req.session.userId;

  const { rows } = await req.db.query(
    `
    SELECT
      u.name,
      u.email,
      u.company,
      u.email_alerts, u.rest_alerts, u.webhook_alerts, u.plan
    FROM users u
    WHERE u.id = $1
    `,
    [userId]
  );

  if (!rows.length) return res.status(404).json({ error: "User not found" });

  res.json(rows[0]);
});

module.exports = router;
