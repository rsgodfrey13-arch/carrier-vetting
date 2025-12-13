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
// POST /api/v1/me/carriers — Add 1 or many carriers
// ---------------------------------------------
router.post('/me/carriers', async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.status(401).json({ error: 'Not authorized' });
    }

    let { dot } = req.body || {};

    // Normalize into an array:
    // "336075" → ["336075"]
    // ["336075", "123456"] → ["336075", "123456"]
    if (!dot) {
      return res.status(400).json({ error: 'dot is required' });
    }

    let dots = Array.isArray(dot) ? dot : [dot];

    // Clean + numeric validation + dedupe
    dots = dots
      .map(d => String(d).trim())
      .filter(d => /^\d+$/.test(d));

    const uniqueDots = [...new Set(dots)];

    if (uniqueDots.length === 0) {
      return res.status(400).json({ error: 'No valid DOT numbers provided' });
    }

    let inserted = 0;
    let duplicates = 0;
    let invalid = 0;
    const details = [];

    for (const d of uniqueDots) {
      // Carrier must exist
      const exists = await pool.query(
        'SELECT 1 FROM carriers WHERE dotnumber = $1 LIMIT 1;',
        [d]
      );

      if (exists.rowCount === 0) {
        invalid++;
        details.push({ dot: d, status: 'invalid' });
        continue;
      }

      // Insert (idempotent)
      const result = await pool.query(
        `
        INSERT INTO user_carriers (user_id, carrier_dot)
        VALUES ($1, $2)
        ON CONFLICT (user_id, carrier_dot) DO NOTHING;
        `,
        [userId, d]
      );

      if (result.rowCount === 1) {
        inserted++;
        details.push({ dot: d, status: 'inserted' });
      } else {
        duplicates++;
        details.push({ dot: d, status: 'already_saved' });
      }
    }

    res.json({
      summary: {
        totalSubmitted: uniqueDots.length,
        inserted,
        duplicates,
        invalid
      },
      details
    });

  } catch (err) {
    console.error('Error in POST /api/v1/me/carriers:', err);
    res.status(500).json({ error: 'Failed to add carriers' });
  }
});


// ---------------------------------------------
// DELETE /api/v1/me/carriers — Remove 1 or many carriers
// ---------------------------------------------
router.delete('/me/carriers', async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.status(401).json({ error: 'Not authorized' });
    }

    let { dot } = req.body || {};

    if (!dot) {
      return res.status(400).json({ error: 'dot is required' });
    }

    // Normalize to array
    let dots = Array.isArray(dot) ? dot : [dot];

    // Clean + numeric-only + dedupe
    dots = dots
      .map(d => String(d).trim())
      .filter(d => /^\d+$/.test(d));

    const uniqueDots = [...new Set(dots)];

    if (uniqueDots.length === 0) {
      return res.status(400).json({ error: 'No valid DOT numbers provided' });
    }

    // Delete in bulk and see what was actually removed
    const deleteResult = await pool.query(
      `
      DELETE FROM user_carriers
      WHERE user_id = $1
        AND carrier_dot = ANY($2::text[])
      RETURNING carrier_dot;
      `,
      [userId, uniqueDots]
    );

    const deletedDots = deleteResult.rows.map(r => r.carrier_dot);
    const deletedSet = new Set(deletedDots);

    const details = uniqueDots.map(d => ({
      dot: d,
      status: deletedSet.has(d) ? 'deleted' : 'not_found'
    }));

    const deleted = deletedDots.length;
    const notFound = uniqueDots.length - deleted;

    res.json({
      summary: {
        totalSubmitted: uniqueDots.length,
        deleted,
        notFound
      },
      details
    });
  } catch (err) {
    console.error('Error in DELETE /api/v1/me/carriers:', err);
    res.status(500).json({ error: 'Failed to remove carriers' });
  }
});

// ---------------------------------------------
// GET /api/v1/carriers/:dot/alerts
// Returns payload objects (info -> changes -> carrier)
// Includes ALL statuses except NEW (not ready yet)
// ---------------------------------------------
router.get('/carriers/:dot/alerts', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authorized' });

    const dot = String(req.params.dot || '').trim();

    const {
      id,        // alert_id (optional)
      status,    // optional filter; if provided, applies (except NEW is always excluded)
      page = 1,
      pageSize = 25
    } = req.query;

    const limit  = Math.min(parseInt(pageSize, 10) || 25, 100);
    const offset = (parseInt(page, 10) - 1) * limit;

    const conditions = [
      'ra.user_id = $1',
      "ra.channel = 'API'",
      'ra.dotnumber = $2',
      "ra.status <> 'ERROR'"
    ];
    const params = [userId, dot];
    let i = 3;

    if (id) {
      conditions.push(`ra.alert_id = $${i}`);
      params.push(id);
      i++;
    }

    // optional status filter (still blocks NEW by base condition)
    if (status) {
      conditions.push(`ra.status = $${i}`);
      params.push(status);
      i++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const sql = `
      SELECT ra.alert_id, ra.dotnumber, ra.payload, ra.created_at, ra.status
      FROM rest_alerts ra
      ${whereClause}
      ORDER BY ra.created_at DESC
      LIMIT $${i} OFFSET $${i + 1};
    `;

    const countSql = `
      SELECT COUNT(*)::int AS count
      FROM rest_alerts ra
      ${whereClause};
    `;

    const [dataResult, countResult] = await Promise.all([
      pool.query(sql, [...params, limit, offset]),
      pool.query(countSql, params)
    ]);

    const rows = dataResult.rows.map(row => {
      const p = (typeof row.payload === 'string') ? JSON.parse(row.payload) : row.payload;

      return {
        info: {
          alert_id: row.alert_id,
          event_id: p.event_id,
          event_type: p.event_type,
          dotnumber: row.dotnumber,
          occurred_at: p.occurred_at,
          status: row.status,
          created_at: row.created_at
        },
        changes: p.changes,
        carrier: p.carrier
      };
    });

    res.json({
      rows,
      total: countResult.rows[0].count,
      page: parseInt(page, 10),
      pageSize: limit
    });
  } catch (err) {
    console.error('Error in GET /api/v1/carriers/:dot/alerts:', err);
    res.status(500).json({ error: 'Failed to load carrier alerts' });
  }
});


// PATCH /api/v1/alerts/processed
// Body: { "alerts": ["46","47"] }

  router.patch('/alerts/processed', async (req, res) => {
  try {
    const userId = req.user?.id;
    const alertIds = normalizeAlertIds(req.body?.alerts);

    // quick debug snapshot
    console.log('PATCH /api/v1/alerts/processed debug:', {
      userId,
      alertIds,
      authHeader: req.header('Authorization') ? 'present' : 'missing'
    });

    if (!userId) return res.status(401).json({ error: 'Not authorized', debug: { userId } });
    if (alertIds.length === 0) return res.status(400).json({ error: 'alerts array required' });

    // 1) show what rows EXIST before update
    const pre = await pool.query(
      `
      SELECT alert_id, user_id, status, channel
      FROM rest_alerts
      WHERE alert_id = ANY($1::int[])
      ORDER BY alert_id;
      `,
      [alertIds]
    );

    // 2) try update with a slightly safer channel compare
    const updateResult = await pool.query(
      `
      UPDATE rest_alerts
      SET status = 'PROCESSED'
      WHERE user_id = $1
        AND UPPER(channel) = 'API'
        AND alert_id = ANY($2::int[])
      RETURNING alert_id;
      `,
      [userId, alertIds]
    );

    res.json({
      debug: {
        userId,
        foundBeforeUpdate: pre.rows,          // <-- this tells us if the IDs even exist
        updatedIds: updateResult.rows
      }
    });
  } catch (err) {
    console.error('Error in PATCH /api/v1/alerts/processed:', err);
    res.status(500).json({ error: 'Failed', detail: err.message });
  }
});

  
// PATCH /api/v1/alerts/unprocessed
// Body: { "alerts": ["46","47"] }
router.patch('/alerts/unprocessed', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authorized' });

    const alertIds = normalizeAlertIds(req.body?.alerts);
    if (alertIds.length === 0) {
      return res.status(400).json({ error: 'alerts array is required (numeric ids)' });
    }

    const updateResult = await pool.query(
      `
      UPDATE rest_alerts
      SET status = 'NEW'
      WHERE user_id = $1
        AND channel = 'API'
        AND alert_id = ANY($2::int[])
      RETURNING alert_id;
      `,
      [userId, alertIds]
    );

    const updatedIds = updateResult.rows.map(r => String(r.alert_id));
    const updatedSet = new Set(updatedIds);

    res.json({
      summary: {
        totalSubmitted: alertIds.length,
        updated: updatedIds.length,
        notFound: alertIds.length - updatedIds.length
      },
      details: alertIds.map(id => ({
        id: String(id),
        status: updatedSet.has(String(id)) ? 'unprocessed' : 'not_found'
      }))
    });
  } catch (err) {
    console.error('Error in PATCH /api/v1/alerts/unprocessed:', err);
    res.status(500).json({ error: 'Failed to mark alerts unprocessed' });
  }
});




// ---------------------------------------------
// GET /api/v1/alerts
// Returns payload objects (info -> changes -> carrier)
// Includes ALL statuses except NEW (not ready yet)
// Filterable by: id, status, dotnumber
// ---------------------------------------------
router.get('/alerts', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authorized' });

    const {
      id,        // alert_id
      status,    // ALERT / PROCESSED / etc (optional; NEW still excluded)
      dotnumber, // optional
      page = 1,
      pageSize = 25
    } = req.query;

    const limit  = Math.min(parseInt(pageSize, 10) || 25, 100);
    const offset = (parseInt(page, 10) - 1) * limit;

    const conditions = [
      'ra.user_id = $1',
      "ra.channel = 'API'",
      "ra.status <> 'ERROR'"
    ];
    const params = [userId];
    let i = 2;

    if (id) {
      conditions.push(`ra.alert_id = $${i}`);
      params.push(id);
      i++;
    }

    if (status) {
      conditions.push(`ra.status = $${i}`);
      params.push(status);
      i++;
    }

    if (dotnumber) {
      conditions.push(`ra.dotnumber = $${i}`);
      params.push(dotnumber);
      i++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const sql = `
      SELECT ra.alert_id, ra.dotnumber, ra.payload, ra.created_at, ra.status
      FROM rest_alerts ra
      ${whereClause}
      ORDER BY ra.created_at DESC
      LIMIT $${i} OFFSET $${i + 1};
    `;

    const countSql = `
      SELECT COUNT(*)::int AS count
      FROM rest_alerts ra
      ${whereClause};
    `;

    const [dataResult, countResult] = await Promise.all([
      pool.query(sql, [...params, limit, offset]),
      pool.query(countSql, params)
    ]);

    const rows = dataResult.rows.map(row => {
      const p = (typeof row.payload === 'string') ? JSON.parse(row.payload) : row.payload;

      return {
        info: {
          alert_id: row.alert_id,
          event_id: p.event_id,
          event_type: p.event_type,
          dotnumber: row.dotnumber,
          occurred_at: p.occurred_at,
          status: row.status,
          created_at: row.created_at
        },
        changes: p.changes,
        carrier: p.carrier
      };
    });

    res.json({
      rows,
      total: countResult.rows[0].count,
      page: parseInt(page, 10),
      pageSize: limit
    });
  } catch (err) {
    console.error('Error in GET /api/v1/alerts:', err);
    res.status(500).json({ error: 'Failed to load alerts' });
  }
});



// ---------------------------------------------
// GET /api/v1/alerts/new
// Returns ONLY status = 'ALERT' (ready-to-process items)
// ---------------------------------------------
router.get('/alerts/new', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authorized' });

    const {
      id,
      dotnumber,
      page = 1,
      pageSize = 25
    } = req.query;

    const limit  = Math.min(parseInt(pageSize, 10) || 25, 100);
    const offset = (parseInt(page, 10) - 1) * limit;

    const conditions = [
      'ra.user_id = $1',
      "ra.channel = 'API'",
      "ra.status = 'NEW'"
    ];
    const params = [userId];
    let i = 2;

    if (id) {
      conditions.push(`ra.alert_id = $${i}`);
      params.push(id);
      i++;
    }

    if (dotnumber) {
      conditions.push(`ra.dotnumber = $${i}`);
      params.push(dotnumber);
      i++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const sql = `
      SELECT ra.alert_id, ra.dotnumber, ra.payload, ra.created_at, ra.status
      FROM rest_alerts ra
      ${whereClause}
      ORDER BY ra.created_at DESC
      LIMIT $${i} OFFSET $${i + 1};
    `;

    const countSql = `
      SELECT COUNT(*)::int AS count
      FROM rest_alerts ra
      ${whereClause};
    `;

    const [dataResult, countResult] = await Promise.all([
      pool.query(sql, [...params, limit, offset]),
      pool.query(countSql, params)
    ]);

    const rows = dataResult.rows.map(row => {
      const p = (typeof row.payload === 'string') ? JSON.parse(row.payload) : row.payload;

      return {
        info: {
          alert_id: row.alert_id,
          event_id: p.event_id,
          event_type: p.event_type,
          dotnumber: row.dotnumber,
          occurred_at: p.occurred_at,
          status: row.status,
          created_at: row.created_at
        },
        changes: p.changes,
        carrier: p.carrier
      };
    });

    res.json({
      rows,
      total: countResult.rows[0].count,
      page: parseInt(page, 10),
      pageSize: limit
    });
  } catch (err) {
    console.error('Error in GET /api/v1/alerts/new:', err);
    res.status(500).json({ error: 'Failed to load NEW alerts' });
  }
});



  
  // Add more v1 routes above this line
  return router;
}

module.exports = createApiV1;
