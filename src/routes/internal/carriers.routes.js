"use strict";

const express = require("express");
const { pool } = require("../../db/pool");

const router = express.Router();

/** ---------- CARRIER ROUTES ---------- **/

router.get("/carriers", async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const pageSize = parseInt(req.query.pageSize, 10) || 25;
    const offset = (page - 1) * pageSize;

    const sortBy = req.query.sortBy || null;
    const sortDir =
      (req.query.sortDir || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";

    const sortMap = {
      dot: "dotnumber",
      mc: "mc_number",
      carrier: "COALESCE(legalname, dbaname)",
      location: "COALESCE(phycity,'') || ', ' || COALESCE(phystate,'')",
      operating: "allowedtooperate",
      common: "commonauthoritystatus",
      contract: "contractauthoritystatus",
      broker: "brokerauthoritystatus",
      safety: "safetyrating"
    };

    const orderColumn = sortMap[sortBy] || "dotnumber";

    const dataQuery = `
      SELECT
        dotnumber        AS dot,
        phystreet        AS address1,
        NULL             AS address2,
        phycity          AS city,
        phystate         AS state,
        phyzipcode       AS zip,
        TO_CHAR(retrieval_date::timestamp, 'Mon DD, YYYY HH12:MI AM EST') AS retrieval_date_formatted,
        *
      FROM public.carriers
      ORDER BY ${orderColumn} ${sortDir}
      LIMIT $1 OFFSET $2
    `;

    const countQuery = `SELECT COUNT(*)::int AS count FROM public.carriers`;

    const [dataResult, countResult] = await Promise.all([
      pool.query(dataQuery, [pageSize, offset]),
      pool.query(countQuery)
    ]);

    res.json({
      rows: dataResult.rows,
      total: countResult.rows[0].count,
      page,
      pageSize
    });
  } catch (err) {
    console.error("Error in GET /api/carriers:", err);
    res.status(500).json({ error: "Database query failed" });
  }
});

/**
 * SINGLE CARRIER – used by /12345 page (carrier.html)
 */
router.get("/carriers/:dot", async (req, res) => {
  try {
    const dot = req.params.dot;
    console.log("Looking up carrier dot:", dot);

    const carrierResult = await pool.query(
      `
      SELECT
        dotnumber        AS dot,
        phystreet as address1,
        null as address2,
        phycity as city,
        phystate as state,
        phyzipcode as zip,
        TO_CHAR(retrieval_date::timestamp, 'Mon DD, YYYY HH12:MI AM EST') AS retrieval_date_formatted,
        *
      FROM public.carriers
      WHERE dotnumber = $1;
      `,
      [dot]
    );

    if (carrierResult.rows.length === 0) {
      return res.status(404).json({ error: "Carrier not found" });
    }

    const carrier = carrierResult.rows[0];

    const cargoResult = await pool.query(
      `
      SELECT cargo_desc, cargo_class
      FROM public.cargo
      WHERE dot_number = $1
      ORDER BY cargo_desc;
      `,
      [dot]
    );

    carrier.cargo_carried = cargoResult.rows.map((r) => r.cargo_desc);

    res.json(carrier);
  } catch (err) {
    console.error("Error in GET /api/carriers/:dot:", err);
    res.status(500).json({ error: "Database query failed" });
  }
});

module.exports = router;
