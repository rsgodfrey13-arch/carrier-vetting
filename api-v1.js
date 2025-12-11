// api-v1.js
const express = require('express');

function createApiV1(pool, requireAuth) {
  const router = express.Router();

  // ---------------------------------------------
  // GET /api/v1/carriers/:dot  (mounted as /carriers/:dot here)
  // ---------------------------------------------
  router.get('/carriers/:dot', async (req, res) => {
    const dot = req.params.dot;

    try {
      const carrierResult = await pool.query(`
        SELECT
          dotnumber AS dot,
          phystreet as address1,
          null as address2,
          phycity as city,
          phystate as state,
          phyzipcode as zip,
          TO_CHAR(retrieval_date::timestamp, 'Mon DD, YYYY HH12:MI AM EST') AS retrieval_date_formatted,
          *
        FROM public.carriers
        WHERE dotnumber = $1;
      `, [dot]);

      if (carrierResult.rows.length === 0) {
        return res.status(404).json({ error: 'Carrier not found' });
      }

      const carrier = carrierResult.rows[0];

      const cargoResult = await pool.query(
        `SELECT cargo_desc, cargo_class
         FROM public.cargo
         WHERE dot_number = $1
         ORDER BY cargo_desc;`,
        [dot]
      );

      carrier.cargo_carried = cargoResult.rows.map(r => r.cargo_desc);

      res.json(carrier);
    } catch (err) {
      console.error('Error in GET /api/v1/carriers/:dot:', err);
      res.status(500).json({ error: 'Database query failed' });
    }
  });

  // ---------------------------------------------
  // GET /api/v1/carriers — Search / list carriers
  // (mounted as /carriers here)
  // ---------------------------------------------
  router.get('/carriers', async (req, res) => {
    try {
      const {
        q,
        dot,
        mc,
        state,
        city,
        page = 1,
        pageSize = 25
      } = req.query;

      const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
      const offset = (parseInt(page, 10) - 1) * limit;

      // Require at least one filter
      if (!q && !dot && !mc && !state && !city) {
        return res.status(400).json({
          error: "At least one search parameter is required (q, dot, mc, state, city)"
        });
      }

      // Build WHERE clause dynamically
      const conditions = [];
      const params = [];
      let i = 1;

      if (q) {
        conditions.push(
          `(dotnumber ILIKE $${i} OR legalname ILIKE $${i} OR dbaname ILIKE $${i})`
        );
        params.push(`%${q}%`);
        i++;
      }

      if (dot) {
        conditions.push(`dotnumber = $${i}`);
        params.push(dot);
        i++;
      }

      if (mc) {
        conditions.push(`mc_number = $${i}`);
        params.push(mc);
        i++;
      }

      if (state) {
        conditions.push(`phystate ILIKE $${i}`);
        params.push(state);
        i++;
      }

      if (city) {
        conditions.push(`phycity ILIKE $${i}`);
        params.push(city);
        i++;
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const sql = `
        SELECT
          dotnumber AS dot,
          legalname,
          dbaname,
          phycity AS city,
          phystate AS state,
          allowedtooperate,
          safetyrating
        FROM carriers
        ${whereClause}
        ORDER BY legalname
        LIMIT ${limit} OFFSET ${offset};
      `;

      const countSql = `
        SELECT COUNT(*)::int AS count
        FROM carriers
        ${whereClause};
      `;

      const [dataResult, countResult] = await Promise.all([
        pool.query(sql, params),
        pool.query(countSql, params)
      ]);

      res.json({
        rows: dataResult.rows,
        total: countResult.rows[0].count,
        page: parseInt(page, 10),
        pageSize: limit
      });
    } catch (err) {
      console.error('Error in GET /api/v1/carriers:', err);
      res.status(500).json({ error: 'Search failed' });
    }
  });

  // Add more v1 routes above this line
  return router;
}

module.exports = createApiV1;
