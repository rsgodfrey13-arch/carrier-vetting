"use strict";

const express = require("express");
const { pool } = require("../../db/pool");
const { requireAuth } = require("../../middleware/requireAuth");

const router = express.Router();

/** ---------- MY CARRIERS ROUTES ---------- **/

// Get list of carriers saved by this user (paginated + sortable)
router.get("/my-carriers", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const page = parseInt(req.query.page, 10) || 1;
    const pageSize = parseInt(req.query.pageSize, 10) || 25;
    const offset = (page - 1) * pageSize;

    const sortBy = req.query.sortBy || null;
    const sortDir =
      (req.query.sortDir || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";

    const sortMap = {
      dot: "c.dotnumber",
      mc: "c.mc_number",
      carrier: "COALESCE(c.legalname, c.dbaname)",
      location: "COALESCE(c.phycity,'') || ', ' || COALESCE(c.phystate,'')",
      operating: "c.allowedtooperate",
      common: "c.commonauthoritystatus",
      contract: "c.contractauthoritystatus",
      broker: "c.brokerauthoritystatus",
      safety: "c.safetyrating"
    };

    const orderColumn = sortMap[sortBy] || "uc.added_at";

    const dataSql = `
      SELECT
        c.dotnumber AS dot,
        c.*
      FROM user_carriers uc
      JOIN carriers c
        ON c.dotnumber = uc.carrier_dot
      WHERE uc.user_id = $1
      ORDER BY ${orderColumn} ${sortDir}
      LIMIT $2 OFFSET $3;
    `;

    const countSql = `
      SELECT COUNT(*)::int AS count
      FROM user_carriers
      WHERE user_id = $1;
    `;

    const [dataResult, countResult] = await Promise.all([
      pool.query(dataSql, [userId, pageSize, offset]),
      pool.query(countSql, [userId])
    ]);

    res.json({
      rows: dataResult.rows,
      total: countResult.rows[0].count,
      page,
      pageSize
    });
  } catch (err) {
    console.error("Error in GET /api/my-carriers:", err);
    res.status(500).json({ error: "Failed to load user carriers" });
  }
});

// Save a new carrier for this user
router.post("/my-carriers", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { dot } = req.body;

    if (!dot) {
      return res.status(400).json({ error: "Carrier DOT required" });
    }

    const sql = `
      INSERT INTO user_carriers (user_id, carrier_dot)
      VALUES ($1, $2)
      ON CONFLICT (user_id, carrier_dot) DO NOTHING;
    `;

    await pool.query(sql, [userId, dot]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error in POST /api/my-carriers:", err);
    res.status(500).json({ error: "Failed to add carrier" });
  }
});

// Bulk add carriers for this user
router.post("/my-carriers/bulk", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    let { dots } = req.body || {};

    if (!Array.isArray(dots) || dots.length === 0) {
      return res.status(400).json({ error: "dots array required" });
    }

    const uniqueDots = [...new Set(
      dots
        .map((d) => String(d).trim())
        .filter((d) => d && /^\d+$/.test(d))
    )];

    if (uniqueDots.length === 0) {
      return res.status(400).json({ error: "No valid DOT numbers found" });
    }

    const sql = `
      WITH input(dot) AS (
        SELECT UNNEST($2::text[])
      ),
      valid AS (
        SELECT i.dot
        FROM input i
        JOIN carriers c ON c.dotnumber = i.dot
      ),
      ins AS (
        INSERT INTO user_carriers (user_id, carrier_dot, added_at)
        SELECT $1, v.dot, NOW()
        FROM valid v
        ON CONFLICT (user_id, carrier_dot) DO NOTHING
        RETURNING carrier_dot
      )
      SELECT
        (SELECT COUNT(*) FROM input)                    AS submitted,
        (SELECT COUNT(*) FROM valid)                    AS valid,
        (SELECT COUNT(*) FROM ins)                      AS inserted,
        (SELECT COUNT(*) FROM valid) - (SELECT COUNT(*) FROM ins) AS duplicates,
        (SELECT COUNT(*) FROM input) - (SELECT COUNT(*) FROM valid) AS invalid;
    `;

    const result = await pool.query(sql, [userId, uniqueDots]);
    const s = result.rows[0];

    return res.json({
      summary: {
        totalSubmitted: Number(s.submitted),
        inserted: Number(s.inserted),
        duplicates: Number(s.duplicates),
        invalid: Number(s.invalid)
      }
    });
  } catch (err) {
    console.error("Error in POST /api/my-carriers/bulk:", err);
    return res.status(500).json({ error: "Failed to bulk add carriers" });
  }
});

// Preview bulk import (no DB writes)
router.post("/my-carriers/bulk/preview", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    let { dots } = req.body || {};

    if (!Array.isArray(dots) || dots.length === 0) {
      return res.status(400).json({ error: "dots array required" });
    }

    dots = dots
      .map((d) => String(d).trim())
      .filter((d) => d && /^\d+$/.test(d));

    const uniqueDots = [...new Set(dots)];

    if (uniqueDots.length === 0) {
      return res.status(400).json({ error: "No valid DOT numbers found" });
    }

    const carriersRes = await pool.query(
      `
      SELECT dotnumber,
             COALESCE(legalname, dbaname) AS name,
             phycity,
             phystate
      FROM carriers
      WHERE dotnumber = ANY($1::text[]);
      `,
      [uniqueDots]
    );

    const carriersMap = new Map();
    carriersRes.rows.forEach((r) => {
      carriersMap.set(r.dotnumber, {
        dot: r.dotnumber,
        name: r.name,
        city: r.phycity,
        state: r.phystate
      });
    });

    const userRes = await pool.query(
      `
      SELECT carrier_dot
      FROM user_carriers
      WHERE user_id = $1
        AND carrier_dot = ANY($2::text[]);
      `,
      [userId, uniqueDots]
    );

    const userSet = new Set(userRes.rows.map((r) => r.carrier_dot));

    const newList = [];
    const duplicates = [];
    const invalid = [];

    for (const dot of uniqueDots) {
      const carrier = carriersMap.get(dot);

      if (!carrier) {
        invalid.push({
          dot,
          status: "invalid",
          name: null,
          city: null,
          state: null
        });
      } else if (userSet.has(dot)) {
        duplicates.push({
          ...carrier,
          status: "duplicate"
        });
      } else {
        newList.push({
          ...carrier,
          status: "new"
        });
      }
    }

    res.json({
      summary: {
        totalSubmitted: uniqueDots.length,
        new: newList.length,
        duplicates: duplicates.length,
        invalid: invalid.length
      },
      new: newList,
      duplicates,
      invalid
    });
  } catch (err) {
    console.error("Error in POST /api/my-carriers/bulk/preview:", err);
    res.status(500).json({ error: "Failed to preview bulk import" });
  }
});

// Check if THIS dot is already saved for this user
router.get("/my-carriers/:dot", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { dot } = req.params;

  try {
    const result = await pool.query(
      "SELECT 1 FROM user_carriers WHERE user_id = $1 AND carrier_dot = $2",
      [userId, dot]
    );

    if (result.rowCount > 0) {
      return res.json({ saved: true });
    } else {
      return res.status(404).json({ saved: false });
    }
  } catch (err) {
    console.error("Error in GET /api/my-carriers/:dot:", err);
    res.status(500).json({ error: "Failed to check carrier" });
  }
});

// Remove a carrier from this user's list
router.delete("/my-carriers/:dot", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { dot } = req.params;

  try {
    const result = await pool.query(
      "DELETE FROM user_carriers WHERE user_id = $1 AND carrier_dot = $2",
      [userId, dot]
    );

    res.json({ ok: true, deleted: result.rowCount });
  } catch (err) {
    console.error("Error in DELETE /api/my-carriers/:dot:", err);
    res.status(500).json({ error: "Failed to remove carrier" });
  }
});

module.exports = router;
