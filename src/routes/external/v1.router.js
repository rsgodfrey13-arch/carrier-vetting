// api-v1.js
const express = require('express');
const { getPolicyForUser } = require("../../policies/importPolicy");


function normalizeAlertIds(input) {
  if (!input) return [];

  const arr = Array.isArray(input) ? input : [input];

  // numeric strings -> ints, dedupe
  return [...new Set(
    arr
      .map(x => String(x).trim())
      .filter(x => /^\d+$/.test(x))
      .map(x => parseInt(x, 10))
  )];
}

function normalizeIdArray(input) {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : [input];
  return [...new Set(
    arr
      .map(x => String(x).trim())
      .filter(x => /^\d+$/.test(x))
      .map(x => parseInt(x, 10))
  )];
}

function normalizeDotArray(input) {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : [input];
  return [...new Set(
    arr
      .map(d => String(d).trim())
      .filter(d => /^\d+$/.test(d))
  )];
}

function normalizeDotsWithInvalid(input) {
  const invalid = [];
  const cleaned = [];

  const arr = Array.isArray(input) ? input : [input];

  for (const raw of arr) {
    const s = String(raw ?? '').trim();
    if (!s) continue;

    // keep digits only
    const digits = s.replace(/\D/g, '');

    // DOT is typically up to 7 digits
    if (digits.length < 1 || digits.length > 7) {
      invalid.push(s);
      continue;
    }

    cleaned.push(digits);
  }

  const unique = [...new Set(cleaned)];
  return { unique, invalid };
}


function createApiV1(pool) {
  const router = express.Router();

// ---------------------------------------------
// GET /api/v1/me/carriers/import-limits
// tells UI the limits + current usage
// ---------------------------------------------
router.get('/me/carriers/import-limits', async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ error: 'Not authorized' });

    // TODO: replace this with real plan lookup later
    const user = { id: userId, plan: 'FREE' };
    const policy = getPolicyForUser(user);

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS current_total
       FROM user_carriers
       WHERE user_id = $1;`,
      [userId]
    );

    res.json({
      plan: user.plan,
      max_total: policy.MAX_TOTAL,
      max_per_import: policy.MAX_PER_IMPORT,
      chunk_size: policy.CHUNK_SIZE,
      current_total: countRes.rows[0].current_total
    });
  } catch (err) {
    console.error('Error in GET /api/v1/me/carriers/import-limits:', err);
    res.status(500).json({ error: 'Failed to load import limits' });
  }
});

// ---------------------------------------------
// POST /api/v1/me/carriers/import
// Body: { "dots": ["336075","123456", ...] }
// Bulk add carriers to My Carriers with plan caps
// ---------------------------------------------
router.post('/me/carriers/import', async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ error: 'Not authorized' });

    // TODO: replace this with real plan lookup later
    const user = { id: userId, plan: 'FREE' };
    const policy = getPolicyForUser(user);

    // Client sends { dots: [...] }
    const { unique, invalid } = normalizeDotsWithInvalid(req.body?.dots);

    // Enforce per-import cap
    let accepted = unique;
    let rejected_due_to_import_limit = 0;

    if (accepted.length > policy.MAX_PER_IMPORT) {
      rejected_due_to_import_limit = accepted.length - policy.MAX_PER_IMPORT;
      accepted = accepted.slice(0, policy.MAX_PER_IMPORT);
    }

    // Enforce max total carriers cap (FREE_MAX_TOTAL etc.)
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS current_total
       FROM user_carriers
       WHERE user_id = $1;`,
      [userId]
    );

    const currentTotal = countRes.rows[0].current_total;
    const remainingCapacity = Math.max(0, policy.MAX_TOTAL - currentTotal);

    let rejected_due_to_plan_limit = 0;
    if (accepted.length > remainingCapacity) {
      rejected_due_to_plan_limit = accepted.length - remainingCapacity;
      accepted = accepted.slice(0, remainingCapacity);
    }

    // If nothing can be inserted, return summary
    if (accepted.length === 0) {
      return res.json({
        received: unique.length,
        valid_unique: unique.length,
        attempted: 0,
        inserted: 0,
        already_had: 0,
        rejected_due_to_import_limit,
        rejected_due_to_plan_limit,
        invalid_count: invalid.length,
        invalid_sample: invalid.slice(0, policy.MAX_INVALID_TO_RETURN)
      });
    }

    // IMPORTANT: Your current /me/carriers endpoint requires carriers exist.
    // For "lenient", we will NOT check carriers table here.
    // We'll just insert into user_carriers and let your UI join show what exists.
    //
    // Ensure you have a UNIQUE constraint on (user_id, carrier_dot)

    const insertRes = await pool.query(
      `
      WITH input(d) AS (
        SELECT UNNEST($2::text[])
      )
      INSERT INTO user_carriers (user_id, carrier_dot, added_at)
      SELECT $1, d, NOW()
      FROM input
      ON CONFLICT (user_id, carrier_dot) DO NOTHING
      RETURNING carrier_dot;
      `,
      [userId, accepted]
    );

    const inserted = insertRes.rowCount;
    const already_had = accepted.length - inserted;

    res.json({
      received: unique.length,
      valid_unique: unique.length,
      attempted: accepted.length,
      inserted,
      already_had,
      rejected_due_to_import_limit,
      rejected_due_to_plan_limit,
      invalid_count: invalid.length,
      invalid_sample: invalid.slice(0, policy.MAX_INVALID_TO_RETURN)
    });
  } catch (err) {
    console.error('Error in POST /api/v1/me/carriers/import:', err);
    res.status(500).json({ error: 'Failed to import carriers' });
  }
});


  
  

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
      console.error("V1 DB ERROR:", err);   // <— Temp Debug
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
        AND UPPER(channel) = 'API'
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



// =============================
// CONTRACT ROUTES (v1)
// Status lifecycle:
// SENT -> COMPLETED -> PROCESSED
// =============================

// helper to select a contract + carrier
function contractSelectSql(whereClause) {
  return `
    SELECT
      c.contract_id,
      c.user_id,
      c.dotnumber,
      c.status,
      c.created_at,
      c.updated_at,
      c.sent_at,
      c.signed_at,
      c.provider,
      c.external_id,
      c.payload,
      to_jsonb(car) AS carrier
    FROM contracts c
    JOIN carriers car
      ON car.dotnumber = c.dotnumber
    ${whereClause}
  `;
}

// ---------------------------------------------
// GET /api/v1/contracts/new
// "new" = COMPLETED (ready for broker), NOT PROCESSED yet
// ---------------------------------------------
router.get('/contracts/new', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authorized' });

    const page = parseInt(req.query.page, 10) || 1;
    const pageSizeRaw = parseInt(req.query.pageSize, 10) || 25;
    const limit = Math.min(pageSizeRaw, 100);
    const offset = (page - 1) * limit;

    const whereClause = `WHERE c.user_id = $1 AND c.status = 'COMPLETED'`;

    const sql = `
      ${contractSelectSql(whereClause)}
      ORDER BY c.created_at DESC
      LIMIT $2 OFFSET $3;
    `;

    const countSql = `
      SELECT COUNT(*)::int AS count
      FROM contracts c
      ${whereClause};
    `;

    const [dataResult, countResult] = await Promise.all([
      pool.query(sql, [userId, limit, offset]),
      pool.query(countSql, [userId])
    ]);

    res.json({
      contracts: dataResult.rows.map(r => ({
        contract: {
          contract_id: r.contract_id,
          dotnumber: r.dotnumber,
          status: r.status,
          created_at: r.created_at,
          updated_at: r.updated_at,
          sent_at: r.sent_at,
          signed_at: r.signed_at,
          provider: r.provider,
          external_id: r.external_id,
          payload: r.payload
        },
        carrier: r.carrier
      })),
      total: countResult.rows[0].count,
      page,
      pageSize: limit
    });
  } catch (err) {
    console.error('Error in GET /api/v1/contracts/new:', err);
    res.status(500).json({ error: 'Failed to load new contracts' });
  }
});

// ---------------------------------------------
// GET /api/v1/carriers/:dot/contracts
// ---------------------------------------------
router.get('/carriers/:dot/contracts', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authorized' });

    const dot = String(req.params.dot || '').trim();
    if (!/^\d+$/.test(dot)) return res.status(400).json({ error: 'Invalid DOT' });

    const page = parseInt(req.query.page, 10) || 1;
    const pageSizeRaw = parseInt(req.query.pageSize, 10) || 25;
    const limit = Math.min(pageSizeRaw, 100);
    const offset = (page - 1) * limit;

    const whereClause = `WHERE c.user_id = $1 AND c.dotnumber = $2`;

    const sql = `
      ${contractSelectSql(whereClause)}
      ORDER BY c.created_at DESC
      LIMIT $3 OFFSET $4;
    `;

    const countSql = `
      SELECT COUNT(*)::int AS count
      FROM contracts c
      ${whereClause};
    `;

    const [dataResult, countResult] = await Promise.all([
      pool.query(sql, [userId, dot, limit, offset]),
      pool.query(countSql, [userId, dot])
    ]);

    res.json({
      contracts: dataResult.rows.map(r => ({
        contract: {
          contract_id: r.contract_id,
          dotnumber: r.dotnumber,
          status: r.status,
          created_at: r.created_at,
          updated_at: r.updated_at,
          sent_at: r.sent_at,
          signed_at: r.signed_at,
          provider: r.provider,
          external_id: r.external_id,
          payload: r.payload
        },
        carrier: r.carrier
      })),
      total: countResult.rows[0].count,
      page,
      pageSize: limit
    });
  } catch (err) {
    console.error('Error in GET /api/v1/carriers/:dot/contracts:', err);
    res.status(500).json({ error: 'Failed to load carrier contracts' });
  }
});

// ---------------------------------------------
// PATCH /api/v1/contracts/processed
// Body: { "contracts": ["12","13"] }
// only COMPLETED -> PROCESSED
// ---------------------------------------------
router.patch('/contracts/processed', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authorized' });

    const ids = normalizeIdArray(req.body?.contracts);
    if (ids.length === 0) {
      return res.status(400).json({ error: 'contracts array is required (numeric ids)' });
    }

    const updateResult = await pool.query(
      `
      UPDATE contracts
      SET status = 'PROCESSED',
          updated_at = NOW()
      WHERE user_id = $1
        AND contract_id = ANY($2::bigint[])
        AND status = 'COMPLETED'
      RETURNING contract_id;
      `,
      [userId, ids]
    );

    const updated = updateResult.rows.map(r => String(r.contract_id));
    const updatedSet = new Set(updated);

    res.json({
      summary: {
        totalSubmitted: ids.length,
        updated: updated.length,
        notFoundOrNotCompleted: ids.length - updated.length
      },
      details: ids.map(id => ({
        contract_id: String(id),
        status: updatedSet.has(String(id)) ? 'processed' : 'not_found_or_not_completed'
      }))
    });
  } catch (err) {
    console.error('Error in PATCH /api/v1/contracts/processed:', err);
    res.status(500).json({ error: 'Failed to mark contracts processed' });
  }
});

// ---------------------------------------------
// PATCH /api/v1/contracts/unprocessed
// Body: { "contracts": ["12","13"] }
// only PROCESSED -> COMPLETED
// ---------------------------------------------
router.patch('/contracts/unprocessed', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authorized' });

    const ids = normalizeIdArray(req.body?.contracts);
    if (ids.length === 0) {
      return res.status(400).json({ error: 'contracts array is required (numeric ids)' });
    }

    const updateResult = await pool.query(
      `
      UPDATE contracts
      SET status = 'COMPLETED',
          updated_at = NOW()
      WHERE user_id = $1
        AND contract_id = ANY($2::bigint[])
        AND status = 'PROCESSED'
      RETURNING contract_id;
      `,
      [userId, ids]
    );

    const updated = updateResult.rows.map(r => String(r.contract_id));
    const updatedSet = new Set(updated);

    res.json({
      summary: {
        totalSubmitted: ids.length,
        updated: updated.length,
        notFoundOrNotProcessed: ids.length - updated.length
      },
      details: ids.map(id => ({
        contract_id: String(id),
        status: updatedSet.has(String(id)) ? 'unprocessed' : 'not_found_or_not_processed'
      }))
    });
  } catch (err) {
    console.error('Error in PATCH /api/v1/contracts/unprocessed:', err);
    res.status(500).json({ error: 'Failed to mark contracts unprocessed' });
  }
});

// ---------------------------------------------
// POST /api/v1/contracts/send
// Body: { "dot": ["336075","123456"] }  (array or single)
// creates contracts in SENT
// ---------------------------------------------
router.post('/contracts/send', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authorized' });

    const dots = normalizeDotArray(req.body?.dot);
    if (dots.length === 0) {
      return res.status(400).json({ error: 'dot is required (numeric DOT or array of DOTs)' });
    }

    // validate DOTs exist
    const carriersRes = await pool.query(
      `SELECT dotnumber FROM carriers WHERE dotnumber = ANY($1::text[])`,
      [dots]
    );
    const validSet = new Set(carriersRes.rows.map(r => String(r.dotnumber)));
    const validDots = dots.filter(d => validSet.has(d));
    const invalidDots = dots.filter(d => !validSet.has(d));

    if (validDots.length === 0) {
      return res.status(400).json({ error: 'No valid DOTs found in carriers table', invalidDots });
    }

    const insertRes = await pool.query(
      `
      INSERT INTO contracts (user_id, dotnumber, status, payload, sent_at)
      SELECT $1, unnest($2::text[]), 'SENT', '{}'::jsonb, NOW()
      RETURNING contract_id, dotnumber, status, created_at, sent_at;
      `,
      [userId, validDots]
    );

    res.json({
      summary: {
        totalSubmitted: dots.length,
        created: insertRes.rowCount,
        invalidDots: invalidDots.length
      },
      created: insertRes.rows,
      invalidDots
    });
  } catch (err) {
    console.error('Error in POST /api/v1/contracts/send:', err);
    res.status(500).json({ error: 'Failed to send contracts' });
  }
});

// ---------------------------------------------
// GET /api/v1/contracts
// filterable + paginated: status, dotnumber, contract_id, created_after, created_before
// ---------------------------------------------
router.get('/contracts', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authorized' });

    const {
      status,
      dotnumber,
      contract_id,
      created_after,
      created_before,
      page = 1,
      pageSize = 25
    } = req.query;

    const limit = Math.min(parseInt(pageSize, 10) || 25, 100);
    const offset = (parseInt(page, 10) - 1) * limit;

    const conditions = ['c.user_id = $1'];
    const params = [userId];
    let i = 2;

    if (contract_id && /^\d+$/.test(String(contract_id))) {
      conditions.push(`c.contract_id = $${i}`);
      params.push(String(contract_id));
      i++;
    }

    if (status) {
      conditions.push(`c.status = $${i}`);
      params.push(String(status).trim().toUpperCase());
      i++;
    }

    if (dotnumber) {
      conditions.push(`c.dotnumber = $${i}`);
      params.push(String(dotnumber).trim());
      i++;
    }

    if (created_after) {
      conditions.push(`c.created_at >= $${i}`);
      params.push(created_after);
      i++;
    }

    if (created_before) {
      conditions.push(`c.created_at <= $${i}`);
      params.push(created_before);
      i++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const sql = `
      ${contractSelectSql(whereClause)}
      ORDER BY c.created_at DESC
      LIMIT $${i} OFFSET $${i + 1};
    `;

    const countSql = `
      SELECT COUNT(*)::int AS count
      FROM contracts c
      ${whereClause};
    `;

    const [dataResult, countResult] = await Promise.all([
      pool.query(sql, [...params, limit, offset]),
      pool.query(countSql, params)
    ]);

    res.json({
      contracts: dataResult.rows.map(r => ({
        contract: {
          contract_id: r.contract_id,
          dotnumber: r.dotnumber,
          status: r.status,
          created_at: r.created_at,
          updated_at: r.updated_at,
          sent_at: r.sent_at,
          signed_at: r.signed_at,
          provider: r.provider,
          external_id: r.external_id,
          payload: r.payload
        },
        carrier: r.carrier
      })),
      total: countResult.rows[0].count,
      page: parseInt(page, 10),
      pageSize: limit
    });
  } catch (err) {
    console.error('Error in GET /api/v1/contracts:', err);
    res.status(500).json({ error: 'Failed to load contracts' });
  }
});

// ---------------------------------------------
// GET /api/v1/contracts/:contract_id
// ---------------------------------------------
router.get('/contracts/:contract_id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authorized' });

    const contractId = String(req.params.contract_id || '').trim();
    if (!/^\d+$/.test(contractId)) {
      return res.status(400).json({ error: 'Invalid contract_id' });
    }

    const whereClause = `WHERE c.user_id = $1 AND c.contract_id = $2`;

    const sql = `
      ${contractSelectSql(whereClause)}
      LIMIT 1;
    `;

    const result = await pool.query(sql, [userId, contractId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    const r = result.rows[0];

    res.json({
      contract: {
        contract_id: r.contract_id,
        dotnumber: r.dotnumber,
        status: r.status,
        created_at: r.created_at,
        updated_at: r.updated_at,
        sent_at: r.sent_at,
        signed_at: r.signed_at,
        provider: r.provider,
        external_id: r.external_id,
        payload: r.payload
      },
      carrier: r.carrier
    });
  } catch (err) {
    console.error('Error in GET /api/v1/contracts/:contract_id:', err);
    res.status(500).json({ error: 'Failed to load contract' });
  }
});

  

  
  // Add more v1 routes above this line
  return router;
}

module.exports = createApiV1;
