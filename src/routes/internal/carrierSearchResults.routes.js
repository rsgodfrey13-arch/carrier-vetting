"use strict";

const express = require("express");
const { pool } = require("../../db/pool");

const router = express.Router();

// GET /api/search-carriers?q=...&page=1&pageSize=25&sortBy=carrier&sortDir=asc
router.get("/search-carriers", async (req, res) => {
  const qRaw = String(req.query.q || "").trim();
  if (qRaw.length < 2) return res.json({ rows: [], total: 0 });

  const qNorm = qRaw.toLowerCase();
  const qDigits = qRaw.replace(/\D/g, "");
  const isNumericish = qDigits.length >= 2 && /^[\d\s\-().]+$/.test(qRaw);

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
  const offset = (page - 1) * pageSize;

  // whitelist sorting (never trust user input)
  const sortByRaw = String(req.query.sortBy || "carrier");
  const sortDirRaw = String(req.query.sortDir || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";

  const SORTS = {
    dot: "dotnumber",
    mc: "mc_number",
    carrier: "carrier_name_norm",
    location: "phycity, phystate",
    operating: "allowedtooperate",
    common: "commonauthoritystatus",
    contract: "contractauthoritystatus",
    broker: "brokerauthoritystatus",
    safety: "safetyrating",
  };

  const orderExpr = SORTS[sortByRaw] || SORTS.carrier;

  try {
    let whereSql = "";
    let params = [];

    if (isNumericish) {
      // numeric-ish search: DOT/MC prefix using integer range (index-friendly)
      const low = Number(qDigits);
      if (!Number.isFinite(low)) return res.json({ rows: [], total: 0 });
      
      const highStr = qDigits + "9".repeat(10);
      let high = Number(highStr);
      if (!Number.isFinite(high)) high = Number.MAX_SAFE_INTEGER;
    
      whereSql = `WHERE (dotnumber BETWEEN $1 AND $2) OR (mc_number BETWEEN $1 AND $2)`;
      params = [low, high];
    } else {
      // name search: prefix first, then contains (carrier_name_norm already lower)
      const prefix = qNorm + "%";
      const contains = "%" + qNorm + "%";
      whereSql = `WHERE carrier_name_norm LIKE $1 OR carrier_name_norm LIKE $2`;
      params = [prefix, contains];
    }

    // total count
    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM public.carriers
      ${whereSql};
      `,
      params
    );

    const total = countResult.rows?.[0]?.total ?? 0;
    if (total === 0) return res.json({ rows: [], total: 0 });

    // rows
    // NOTE: we keep a "rank" so results feel good for name searches (prefix first).
    let rowsResult;
    
    if (isNumericish) {
      const low = params[0];
      const high = params[1];
    
      // guard exact too (same reason as low/high)
      let exact = Number(qDigits);
      if (!Number.isFinite(exact)) exact = -1; // will never match a real DOT/MC
    
      rowsResult = await pool.query(
        `
        SELECT
          dotnumber AS dot,
          mc_number,
          legalname,
          dbaname,
          phycity,
          phystate,
          allowedtooperate,
          commonauthoritystatus,
          contractauthoritystatus,
          brokerauthoritystatus,
          safetyrating,
          carrier_name_norm,
          CASE
            WHEN dotnumber = $3 THEN 0
            WHEN mc_number = $3 THEN 1
            ELSE 2
          END AS rank
        FROM public.carriers
        WHERE (dotnumber BETWEEN $1 AND $2)
           OR (mc_number BETWEEN $1 AND $2)
        ORDER BY rank ASC, ${orderExpr} ${sortDirRaw}
        LIMIT $4
        OFFSET $5;
        `,
        [low, high, exact, pageSize, offset]
      );
    }
    else {
      rowsResult = await pool.query(
        `
        SELECT
          dotnumber AS dot,
          mc_number,
          legalname,
          dbaname,
          phycity,
          phystate,
          allowedtooperate,
          commonauthoritystatus,
          contractauthoritystatus,
          brokerauthoritystatus,
          safetyrating,
          carrier_name_norm,
          CASE
            WHEN carrier_name_norm LIKE $1 THEN 0
            ELSE 1
          END AS rank
        FROM public.carriers
        WHERE carrier_name_norm LIKE $1
           OR carrier_name_norm LIKE $2
        ORDER BY rank ASC, ${orderExpr} ${sortDirRaw}
        LIMIT $3
        OFFSET $4;
        `,
        [params[0], params[1], pageSize, offset]
      );
    }


    return res.json({ rows: rowsResult.rows, total });
  } catch (err) {
    console.error("search-carriers error", err);
    return res.status(500).json({ error: "Search failed" });
  }
});

module.exports = router;
