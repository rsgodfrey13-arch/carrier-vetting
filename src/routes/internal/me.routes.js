"use strict";

const express = require("express");
const router = express.Router();

router.get("/me", async (req, res) => {
  const userId = req.user?.id || req.session?.user_id;

  if (!userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { rows } = await req.db.query(
    `
    SELECT
      'testname' AS name,
      u.email,
      'testco' AS company
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

module.exports = router;
