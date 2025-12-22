"use strict";

const express = require("express");
const { pool } = require("../../db/pool");

const router = express.Router();

// GET /api/carrier-search?q=...
// Returns top 10 matches for DOT / MC / name
router.get("/carrier-search", async (req, res) => {
  const q = (req.query.q || "").trim();

  // Require at least 2 chars, like the front-end
  if (q.length < 2) {
    return res.json([]);
  }

  const isNumeric = /^\d+$/.test(q);
  const likePrefix = q + "%";
  const nameLike = "%" + q.toLowerCase() + "%";

  try {
    const result = await pool.query(
      `
      SELECT
        dotnumber AS dot,
        mc_number,
        legalname,
        dbaname,
        phycity,
        phystate
      FROM public.carriers
      WHERE
        (
          $1::boolean
          AND (
            dotnumber::text ILIKE $2
            OR mc_number::text ILIKE $2
          )
        )
        OR
        (
          NOT $1::boolean
          AND (
            lower(legalname) LIKE $3
            OR lower(dbaname)  LIKE $3
          )
        )
      ORDER BY legalname
      LIMIT 10;
      `,
      [isNumeric, likePrefix, nameLike]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("carrier-search error", err);
    res.status(500).json({ error: "Search failed" });
  }
});

module.exports = router;
