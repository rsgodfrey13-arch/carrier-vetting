"use strict";

const express = require("express");
const { pool } = require("../../db/pool");

const router = express.Router();

// GET /api/carrier-search?q=...
router.get("/carrier-search", async (req, res) => {
  const qRaw = String(req.query.q || "").trim();
  if (qRaw.length < 2) return res.json([]);

  const qNorm = qRaw.toLowerCase();
  const qDigits = qRaw.replace(/\D/g, "");
  const isNumericish = qDigits.length >= 2 && /^[\d\s\-().]+$/.test(qRaw);

  try {
    // Numeric-ish: DOT/MC prefix using integer range (index-friendly)
    if (isNumericish) {
      const d = qDigits;               // e.g. "123"
      const low = Number(d);           // 123
      const high = Number(d + "9".repeat(10)); // 1239999999999 (big range)
    
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
        WHERE (dotnumber BETWEEN $1 AND $2)
           OR (mc_number BETWEEN $1 AND $2)
        ORDER BY
          CASE
            WHEN dotnumber = $3 THEN 0
            WHEN mc_number = $3 THEN 1
            ELSE 2
          END,
          dotnumber
        LIMIT 10;
        `,
        [low, high, low]
      );
    
      return res.json(result.rows);
    }


      return res.json(result.rows);
    }

    // Name: prefix hits first, then contains/fuzzy fallback (trigram index)
    const prefix = qNorm + "%";
    const contains = "%" + qNorm + "%";

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
      WHERE carrier_name_norm LIKE $1
         OR carrier_name_norm LIKE $2
      ORDER BY
        CASE
          WHEN carrier_name_norm LIKE $1 THEN 0
          ELSE 1
        END,
        carrier_name_norm
      LIMIT 10;
      `,
      [prefix, contains]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("carrier-search error", err);
    return res.status(500).json({ error: "Search failed" });
  }
});

module.exports = router;
