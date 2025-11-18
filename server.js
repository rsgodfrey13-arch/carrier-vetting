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


/** ---------- MY CARRIERS ROUTES ---------- **/

// Get list of carriers saved by this user
app.get('/api/my-carriers', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const sql = `
      SELECT
        c.dotnumber AS dot,
        c.*
      FROM user_carriers uc
      JOIN carriers c
        ON c.dotnumber = uc.carrier_dot
      WHERE uc.user_id = $1
      ORDER BY uc.added_at DESC;
    `;

    const result = await pool.query(sql, [userId]);
    res.json(result.rows);
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
    const result = await pool.query(`
      SELECT
        dotnumber        AS dot,
        phyStreet as address1,
        null as address2,
        phycity as city,
        phystate as state,
        phyzipcode as zip,
        TO_CHAR(retrieval_date::timestamp, 'Mon DD, YYYY HH12:MI AM EST') AS retrieval_date_formatted,
        *
      FROM public.carriers
      ORDER BY dotnumber
      LIMIT 50;
    `);

    console.log('Rows from DB:', result.rows); // debug
    res.json(result.rows);
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
      `SELECT cargo_class_desc
       FROM carrier_cargo
       WHERE dot_number = $1
       ORDER BY cargo_class_desc;`,
      [dot]
    );

    // Convert row list → array of strings
    const cargoList = cargoResult.rows.map(r => r.cargo_class_desc);

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
