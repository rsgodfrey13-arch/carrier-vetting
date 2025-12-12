const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// If you're behind a proxy (DigitalOcean App Platform), this helps cookies work correctly
app.set('trust proxy', 1);

// Serve static files (index.html, carrier.html, style1.css, etc.)
app.use(express.static(__dirname));

// Parse JSON bodies for POST/PUT
app.use(express.json());

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me', // set real one in env later
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'  // true on DO with https, false locally
  }
}));


/**
 * HARD-CODED Postgres connection (same idea as your OLD version).
 * Put back the exact values you used when it was working.
 */
const pool = new Pool({
  host: 'carrier-vetting-do-user-27858216-0.e.db.ondigitalocean.com',      // e.g. db-postgresql-xxxx.b.db.ondigitalocean.com
  port: 25060,               // DigitalOcean default
  database: 'defaultdb',     // or whatever your DB name is
  user: 'doadmin',           // or your user
  password: 'AVNS_QZfAFA-4TzNXYII9lET',
  ssl: { rejectUnauthorized: false }
});

/** ---------- AUTH HELPERS & ROUTES ---------- **/

// helper: require that user is logged in
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  next();
}

// who am I? (used by UI + Postman to check login)
app.get('/api/me', (req, res) => {
  if (!req.session?.userId) {
    return res.json({ user: null });
  }
  res.json({ user: { id: req.session.userId } });
});

// login: expects { "email": "x", "password": "y" }
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, password_hash FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // success → set session
    req.session.userId = user.id;
    res.json({ ok: true });
  } catch (err) {
    console.error('Error in POST /api/login:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

/** ---------- API v1 Router ---------- **/
const createApiV1 = require('./api-v1');

// pass null for requireAuth for now (we aren't using auth on v1 yet)
const apiV1 = createApiV1(pool, null);

// mount at /api/v1
app.use('/api/v1', apiV1);

// GET /api/carrier-search?q=...
// Returns top 10 matches for DOT / MC / name
router.get('/carrier-search', async (req, res) => {
  const q = (req.query.q || '').trim();

  // Require at least 2 chars, like the front-end
  if (q.length < 2) {
    return res.json([]);
  }

  // Decide how to search
  const isNumeric = /^\d+$/.test(q);
  const likePrefix = q + '%';
  const nameLike = '%' + q.toLowerCase() + '%';

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
        -- numeric search hits DOT / MC prefixes
        (
          $1::boolean
          AND (
            dotnumber::text ILIKE $2
            OR mc_number::text ILIKE $2
          )
        )
        OR
        -- text search hits carrier names
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
      [
        isNumeric,     // $1
        likePrefix,    // $2
        nameLike       // $3
      ]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('carrier-search error', err);
    res.status(500).json({ error: 'Search failed' });
  }
});


/** ---------- MY CARRIERS ROUTES ---------- **/

// Get list of carriers saved by this user (paginated + sortable)
app.get('/api/my-carriers', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const page     = parseInt(req.query.page, 10)     || 1;
    const pageSize = parseInt(req.query.pageSize, 10) || 25;
    const offset   = (page - 1) * pageSize;

    // ----- NEW: read sort params -----
    const sortBy = req.query.sortBy || null;
    const sortDir = (req.query.sortDir || 'asc').toLowerCase() === 'desc'
      ? 'DESC'
      : 'ASC';

    // ----- NEW: map UI columns → real database columns safely -----
    const sortMap = {
      dot:      'c.dotnumber',
      mc:       'c.mc_number',
      carrier:  "COALESCE(c.legalname, c.dbaname)", 
      location: "COALESCE(c.phycity,'') || ', ' || COALESCE(c.phystate,'')",
      operating: "c.allowedtooperate",
      common:    "c.commonauthoritystatus",
      contract:  "c.contractauthoritystatus",
      broker:    "c.brokerauthoritystatus",
      safety:    "c.safetyrating"
    };

    // fallback if missing or invalid
    const orderColumn = sortMap[sortBy] || 'uc.added_at';

    // ----- FINAL SQL (paginated + sorted) -----
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
    console.error('Error in GET /api/my-carriers:', err);
    res.status(500).json({ error: 'Failed to load user carriers' });
  }
});



// Save a new carrier for this user
app.post('/api/my-carriers', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { dot } = req.body;

    if (!dot) {
      return res.status(400).json({ error: 'Carrier DOT required' });
    }

    const sql = `
      INSERT INTO user_carriers (user_id, carrier_dot)
      VALUES ($1, $2)
      ON CONFLICT (user_id, carrier_dot) DO NOTHING;
    `;

    await pool.query(sql, [userId, dot]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error in POST /api/my-carriers:', err);
    res.status(500).json({ error: 'Failed to add carrier' });
  }
});


// Bulk add carriers for this user
app.post('/api/my-carriers/bulk', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    let { dots } = req.body || {};

    if (!Array.isArray(dots) || dots.length === 0) {
      return res.status(400).json({ error: 'dots array required' });
    }

    // clean + dedupe
    dots = dots
      .map(d => String(d).trim())
      .filter(d => d && /^\d+$/.test(d)); // only numeric DOTs

    const uniqueDots = [...new Set(dots)];

    if (uniqueDots.length === 0) {
      return res.status(400).json({ error: 'No valid DOT numbers found' });
    }

    let inserted = 0;
    let duplicates = 0;
    let invalid = 0;
    const details = [];

    for (const dot of uniqueDots) {
      // Check that this DOT exists in carriers table
      const carrierExists = await pool.query(
        'SELECT 1 FROM carriers WHERE dotnumber = $1 LIMIT 1;',
        [dot]
      );

      if (carrierExists.rowCount === 0) {
        invalid++;
        details.push({ dot, status: 'invalid' });
        continue;
      }

      const result = await pool.query(
        `
        INSERT INTO user_carriers (user_id, carrier_dot)
        VALUES ($1, $2)
        ON CONFLICT (user_id, carrier_dot) DO NOTHING;
        `,
        [userId, dot]
      );

      if (result.rowCount === 1) {
        inserted++;
        details.push({ dot, status: 'inserted' });
      } else {
        duplicates++;
        details.push({ dot, status: 'duplicate' });
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
    console.error('Error in POST /api/my-carriers/bulk:', err);
    res.status(500).json({ error: 'Failed to bulk add carriers' });
  }
});

// Preview bulk import (no DB writes)
app.post('/api/my-carriers/bulk/preview', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    let { dots } = req.body || {};

    if (!Array.isArray(dots) || dots.length === 0) {
      return res.status(400).json({ error: 'dots array required' });
    }

    // clean + dedupe
    dots = dots
      .map(d => String(d).trim())
      .filter(d => d && /^\d+$/.test(d));

    const uniqueDots = [...new Set(dots)];

    if (uniqueDots.length === 0) {
      return res.status(400).json({ error: 'No valid DOT numbers found' });
    }

    // Get which dots exist in carriers
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
    carriersRes.rows.forEach(r => {
      carriersMap.set(r.dotnumber, {
        dot: r.dotnumber,
        name: r.name,
        city: r.phycity,
        state: r.phystate
      });
    });

    // Get which of those dots user already has
    const userRes = await pool.query(
      `
      SELECT carrier_dot
      FROM user_carriers
      WHERE user_id = $1
        AND carrier_dot = ANY($2::text[]);
      `,
      [userId, uniqueDots]
    );

    const userSet = new Set(userRes.rows.map(r => r.carrier_dot));

    const newList = [];
    const duplicates = [];
    const invalid = [];

    for (const dot of uniqueDots) {
      const carrier = carriersMap.get(dot);

      if (!carrier) {
        invalid.push({
          dot,
          status: 'invalid',
          name: null,
          city: null,
          state: null
        });
      } else if (userSet.has(dot)) {
        duplicates.push({
          ...carrier,
          status: 'duplicate'
        });
      } else {
        newList.push({
          ...carrier,
          status: 'new'
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
    console.error('Error in POST /api/my-carriers/bulk/preview:', err);
    res.status(500).json({ error: 'Failed to preview bulk import' });
  }
});




// Check if THIS dot is already saved for this user
app.get('/api/my-carriers/:dot', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { dot } = req.params;

  try {
    const result = await pool.query(
      'SELECT 1 FROM user_carriers WHERE user_id = $1 AND carrier_dot = $2',
      [userId, dot]
    );

    if (result.rowCount > 0) {
      return res.json({ saved: true });
    } else {
      // 404 lets the frontend treat it as "not saved"
      return res.status(404).json({ saved: false });
    }
  } catch (err) {
    console.error('Error in GET /api/my-carriers/:dot:', err);
    res.status(500).json({ error: 'Failed to check carrier' });
  }
});

// Remove a carrier from this user's list
app.delete('/api/my-carriers/:dot', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { dot } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM user_carriers WHERE user_id = $1 AND carrier_dot = $2',
      [userId, dot]
    );

    res.json({ ok: true, deleted: result.rowCount });
  } catch (err) {
    console.error('Error in DELETE /api/my-carriers/:dot:', err);
    res.status(500).json({ error: 'Failed to remove carrier' });
  }
});


/** ---------- CARRIER ROUTES ---------- **/

app.get('/api/carriers', async (req, res) => {
  try {
    const page     = parseInt(req.query.page, 10)     || 1;
    const pageSize = parseInt(req.query.pageSize, 10) || 25;
    const offset   = (page - 1) * pageSize;

    // ----- NEW: sorting -----
    const sortBy = req.query.sortBy || null;
    const sortDir = (req.query.sortDir || 'asc').toLowerCase() === 'desc'
      ? 'DESC'
      : 'ASC';

    // match UI → DB columns
    const sortMap = {
      dot:      'dotnumber',
      mc:       'mc_number',
      carrier:  "COALESCE(legalname, dbaname)",
      location: "COALESCE(phycity,'') || ', ' || COALESCE(phystate,'')",
      operating: "allowedtooperate",
      common:    "commonauthoritystatus",
      contract:  "contractauthoritystatus",
      broker:    "brokerauthoritystatus",
      safety:    "safetyrating"
    };

    const orderColumn = sortMap[sortBy] || 'dotnumber';

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
    console.error('Error in GET /api/carriers:', err);
    res.status(500).json({ error: 'Database query failed' });
  }
});



/**
 * SEARCH – used by the autocomplete
 */
app.get('/api/carriers/search', async (req, res) => {
  const q = (req.query.q || '').trim();

  if (!q) {
    return res.json([]);
  }

  try {
    const result = await pool.query(
      `
      SELECT
        dotnumber,
        legalname,
        dbaname,
        phycity,
        phystate
      FROM carriers
      WHERE
        dotnumber ILIKE $1
        OR legalname ILIKE $1
        OR dbaname ILIKE $1
      ORDER BY legalname
      LIMIT 15;
      `,
      ['%' + q + '%']
    );

    res.json(
      result.rows.map(r => ({
        dot: r.dotnumber,
        legalname: r.legalname,
        dbaname: r.dbaname,
        city: r.phycity,
        state: r.phystate
      }))
    );
  } catch (err) {
    console.error('Error in GET /api/carriers/search:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * SINGLE CARRIER – used by /12345 page (carrier.html)
 */
app.get('/api/carriers/:dot', async (req, res) => {
  try {
    const dot = req.params.dot;
    console.log('Looking up carrier dot:', dot);

    // 1) Get base carrier row
    const carrierResult = await pool.query(`
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
    `, [dot]);

    if (carrierResult.rows.length === 0) {
      return res.status(404).json({ error: 'Carrier not found' });
    }

    const carrier = carrierResult.rows[0];

    // 2) Get cargo carried rows
    const cargoResult = await pool.query(
      `SELECT cargo_desc, cargo_class
       FROM public.cargo
       WHERE dot_number = $1
       ORDER BY cargo_desc;`,
      [dot]
    );

    // Convert row list → array of strings
    const cargoList = cargoResult.rows.map(r => r.cargo_desc);

    // 3) Attach it to the carrier object
    carrier.cargo_carried = cargoList;

    // 4) Return combined carrier object
    res.json(carrier);

  } catch (err) {
    console.error('Error in GET /api/carriers/:dot:', err);
    res.status(500).json({ error: 'Database query failed' });
  }
});


/**
 * PRETTY URL: /12345 → serve carrier.html
 * This must be AFTER /api/* routes.
 */
app.get('/:dot(\\d+)', (req, res) => {
  res.sendFile(path.join(__dirname, 'carrier.html'));
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

/** ---------- Removed ---------- -
app.get('/api/carriers/search', async (req, res) => {
  const q = (req.query.q || '').trim();

  if (!q) {
    return res.json([]);
  }

  try {
    const result = await pool.query(
      `
      SELECT
        dotnumber,
        legalname,
        dbaname,
        phycity,
        phystate
      FROM carriers
      WHERE
        dotnumber ILIKE $1
        OR legalname ILIKE $1
        OR dbaname ILIKE $1
      ORDER BY legalname
      LIMIT 15;
      `,
      ['%' + q + '%']
    );

    res.json(
      result.rows.map(r => ({
        dot: r.dotnumber,
        legalname: r.legalname,
        dbaname: r.dbaname,
        city: r.phycity,
        state: r.phystate
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed' });
  }
});

**/

