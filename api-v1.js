// api-v1.js
const express = require('express');

function createApiV1(pool) {
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
// GET /api/v1/carriers — field-based search / list
// ---------------------------------------------
router.get('/carriers', async (req, res) => {
  try {
    const {
      dot,
      mc,
      legalname,
      dbaname,
      city,
      state,
      page = 1,
      pageSize = 25
    } = req.query;

    const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
    const offset = (parseInt(page, 10) - 1) * limit;

    // Require at least one filter
    if (!dot && !mc && !legalname && !dbaname && !city && !state) {
      return res.status(400).json({
        error: "At least one search parameter is required (dot, mc, legalname, dbaname, city, state)"
      });
    }

    const conditions = [];
    const params = [];
    let i = 1;

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

    if (legalname) {
      conditions.push(`legalname ILIKE $${i}`);
      params.push(`%${legalname}%`);
      i++;
    }

    if (dbaname) {
      conditions.push(`dbaname ILIKE $${i}`);
      params.push(`%${dbaname}%`);
      i++;
    }

    if (city) {
      conditions.push(`phycity ILIKE $${i}`);
      params.push(`%${city}%`);
      i++;
    }

    if (state) {
      conditions.push(`phystate ILIKE $${i}`);
      params.push(`%${state}%`);
      i++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

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

  // ---------------------------------------------
// GET /api/v1/me/carriers — user's carriers
// ---------------------------------------------
router.get('/me/carriers', async (req, res) => {
  try {
      // API key auth user
      const userId = req.user && req.user.id;
      if (!userId) {
        return res.status(401).json({ error: 'Not authorized' });
      }

    const {
      dot,
      mc,
      legalname,
      dbaname,
      city,
      state,
      page = 1,
      pageSize = 25
    } = req.query;

    const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
    const offset = (parseInt(page, 10) - 1) * limit;

    // Base condition: this user's saved carriers
    const conditions = ['uc.user_id = $1'];
    const params = [userId];
    let i = 2; // start at $2 because $1 is user_id

    if (dot) {
      conditions.push(`c.dotnumber = $${i}`);
      params.push(dot);
      i++;
    }

    if (mc) {
      conditions.push(`c.mc_number = $${i}`);
      params.push(mc);
      i++;
    }

    if (legalname) {
      conditions.push(`c.legalname ILIKE $${i}`);
      params.push(`%${legalname}%`);
      i++;
    }

    if (dbaname) {
      conditions.push(`c.dbaname ILIKE $${i}`);
      params.push(`%${dbaname}%`);
      i++;
    }

    if (city) {
      conditions.push(`c.phycity ILIKE $${i}`);
      params.push(`%${city}%`);
      i++;
    }

    if (state) {
      conditions.push(`c.phystate ILIKE $${i}`);
      params.push(`%${state}%`);
      i++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const sql = `
      SELECT
        c.dotnumber AS dot,
        c.legalname,
        c.dbaname,
        c.phycity  AS city,
        c.phystate AS state,
        c.allowedtooperate,
        c.safetyrating,
        uc.added_at
      FROM user_carriers uc
      JOIN carriers c
        ON c.dotnumber = uc.carrier_dot
      ${whereClause}
      ORDER BY c.legalname
      LIMIT ${limit} OFFSET ${offset};
    `;

    const countSql = `
      SELECT COUNT(*)::int AS count
      FROM user_carriers uc
      JOIN carriers c
        ON c.dotnumber = uc.carrier_dot
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
    console.error('Error in GET /api/v1/me/carriers:', err);
    res.status(500).json({ error: 'Failed to load user carriers' });
  }
});


// ---------------------------------------------
// POST /api/v1/me/carriers — Add carrier to saved list
// ---------------------------------------------
router.post('/me/carriers', async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.status(401).json({ error: 'Not authorized' });
    }

    let { dot } = req.body || {};

    if (!dot) {
      return res.status(400).json({ error: 'Carrier DOT required' });
    }

    dot = String(dot).trim();

    if (!/^\d+$/.test(dot)) {
      return res.status(400).json({ error: 'DOT must be numeric' });
    }

    // 1) Ensure carrier exists
    const carrierExists = await pool.query(
      'SELECT 1 FROM carriers WHERE dotnumber = $1 LIMIT 1;',
      [dot]
    );

    if (carrierExists.rowCount === 0) {
      return res.status(404).json({ error: 'Carrier not found' });
    }

    // 2) Insert into user_carriers (idempotent)
    const insertResult = await pool.query(
      `
      INSERT INTO user_carriers (user_id, carrier_dot)
      VALUES ($1, $2)
      ON CONFLICT (user_id, carrier_dot) DO NOTHING;
      `,
      [userId, dot]
    );

    if (insertResult.rowCount === 0) {
      // already there
      return res.json({
        ok: true,
        dot,
        status: 'already_saved'
      });
    }

    // successfully added
    res.json({
      ok: true,
      dot,
      status: 'inserted'
    });
  } catch (err) {
    console.error('Error in POST /api/v1/me/carriers:', err);
    res.status(500).json({ error: 'Failed to add carrier' });
  }
});


  
  // Add more v1 routes above this line
  return router;
}

module.exports = createApiV1;
