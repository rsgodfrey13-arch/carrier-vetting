const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

const AWS = require("aws-sdk");

const spaces = new AWS.S3({
  endpoint: `https://${process.env.SPACES_REGION}.digitaloceanspaces.com`,
  accessKeyId: process.env.SPACES_KEY,
  secretAccessKey: process.env.SPACES_SECRET,
  s3ForcePathStyle: true,
  signatureVersion: "v4"
});





// Mailgun Stuff
const { sendContractEmail } = require("./mailgun");
const crypto = require("crypto");
function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}


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


/** ---------- CONTRACT PDF (token-gated) ---------- **/
app.get("/contract/:token/pdf", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).send("Missing token");

  try {
    // 1) Lookup contract + template key
    const sql = `
      SELECT
        c.contract_id,
        c.status,
        c.token_expires_at,
        uc.storage_provider,
        uc.storage_key,
        uc.name AS contract_name
      FROM public.contracts c
      JOIN public.user_contracts uc
        ON uc.id = c.user_contract_id
      WHERE c.token = $1
      LIMIT 1;
    `;

    const { rows } = await pool.query(sql, [token]);
    if (rows.length === 0) return res.status(404).send("Invalid link");

    const row = rows[0];

    // 2) Expiration check
    if (row.token_expires_at && new Date(row.token_expires_at) < new Date()) {
      return res.status(410).send("This link has expired");
    }

    // 3) Validate storage fields
    if (row.storage_provider !== "DO_SPACES") {
      return res.status(500).send("Storage provider not configured");
    }
    if (!row.storage_key) {
      return res.status(500).send("Missing storage key");
    }

    // 4) Stream PDF from Spaces
const Bucket = process.env.SPACES_BUCKET;
    const Key = row.storage_key;

    const obj = spaces.getObject({ Bucket, Key }).createReadStream();

    // If the stream errors (missing key, perms), return 404/500
    obj.on("error", (err) => {
      console.error("SPACES getObject error:", err?.code, err?.message, err);
      if (err?.code === "NoSuchKey") return res.status(404).send("PDF not found");
      return res.status(500).send("Failed to load PDF");
    });

    // 5) Headers for inline display
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=\"contract.pdf\"");
    res.setHeader("Cache-Control", "no-store");

    // 6) Pipe it
    obj.pipe(res);
  } catch (err) {
    console.error("GET /contract/:token/pdf error:", err?.message, err);
    return res.status(500).send("Server error");
  }
});




/** ---------- CONTRACT SEND ROUTE ---------- **/
app.post("/api/contracts/send/:dot", requireAuth, async (req, res) => {
  const dotnumber = req.params.dot;
  const { user_contract_id, email_to } = req.body || {};

  const user_id = req.session.userId;
  if (!user_id) return res.status(401).json({ error: "Not authenticated" });

  if (!user_contract_id || !email_to) {
    return res.status(400).json({ error: "user_contract_id and email_to are required" });
  }

  const token = makeToken();
  const token_expires_at = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const link = `https://carriershark.com/contract/${token}`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insertSql = `
      INSERT INTO public.contracts
        (user_id, dotnumber, status, channel, provider, payload, sent_at, token, token_expires_at, email_to, user_contract_id)
      VALUES
        ($1, $2, 'SENT', 'EMAIL', 'MAILGUN', '{}'::jsonb, NOW(), $3, $4, $5, $6)
      RETURNING contract_id;
    `;

    const { rows } = await client.query(insertSql, [
      user_id,
      dotnumber,
      token,
      token_expires_at.toISOString(),
      email_to,
      user_contract_id
    ]);

    const contract_id = rows[0]?.contract_id;
    if (!contract_id) {
      throw new Error("Insert succeeded but no contract_id returned");
    }

    await sendContractEmail({ to: email_to, dotnumber, link });

    await client.query("COMMIT");
    return res.json({ ok: true, contract_id, status: "SENT", link });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rbErr) {
      console.error("ROLLBACK ERROR:", rbErr);
    }

    console.error("SEND CONTRACT ERROR:", err?.message, err?.detail, err);

    return res.status(500).json({
      error: "Failed to send contract",
      message: err?.message || String(err),
      detail: err?.detail || null
    });
  } finally {
    client.release();
  }
});



/** ---------- CONTRACT ACK (token-gated) ---------- **/
app.post("/contract/:token/ack", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).json({ error: "Missing token" });

  const { ack, name, title, email } = req.body || {};

  // basic validation
  if (ack !== true) {
    return res.status(400).json({ error: "ack must be true" });
  }
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: "title is required" });
  }

  const accepted_name = String(name).trim();
  const accepted_title = String(title).trim();
  const accepted_email = email ? String(email).trim() : null;

  // capture audit info
  const accepted_ip =
    (req.headers["x-forwarded-for"] ? String(req.headers["x-forwarded-for"]).split(",")[0].trim() : null)
    || req.ip
    || null;

  const accepted_user_agent = req.get("user-agent") || null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) validate token + not expired, get contract_id
    const contractRes = await client.query(
      `
      SELECT contract_id, token_expires_at
      FROM public.contracts
      WHERE token = $1
      LIMIT 1;
      `,
      [token]
    );

    if (contractRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Invalid link" });
    }

    const contract_id = contractRes.rows[0].contract_id;
    const token_expires_at = contractRes.rows[0].token_expires_at;

    if (token_expires_at && new Date(token_expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return res.status(410).json({ error: "This link has expired" });
    }

    // 2) insert acceptance (idempotent per contract_id)
    await client.query(
      `
      INSERT INTO public.contract_acceptances
        (contract_id, method, accepted_name, accepted_title, accepted_email, accepted_ip, accepted_user_agent)
      VALUES
        ($1, 'ACK', $2, $3, $4, $5, $6)
      ON CONFLICT (contract_id) DO UPDATE
        SET method = EXCLUDED.method,
            accepted_name = EXCLUDED.accepted_name,
            accepted_title = EXCLUDED.accepted_title,
            accepted_email = EXCLUDED.accepted_email,
            accepted_at = NOW(),
            accepted_ip = EXCLUDED.accepted_ip,
            accepted_user_agent = EXCLUDED.accepted_user_agent;
      `,
      [contract_id, accepted_name, accepted_title, accepted_email, accepted_ip, accepted_user_agent]
    );

    // 3) update contract status
    await client.query(
      `
      UPDATE public.contracts
      SET status = 'ACKNOWLEDGED',
          signed_at = NOW(),
          updated_at = NOW()
      WHERE contract_id = $1;
      `,
      [contract_id]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, contract_id, status: "ACKNOWLEDGED" });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("POST /contract/:token/ack error:", err?.message, err);
    return res.status(500).json({ error: "Failed to acknowledge contract" });
  } finally {
    client.release();
  }
});





// API key auth for /api/v1
async function apiAuth(req, res, next) {
  try {
    const auth = req.header('Authorization') || '';
    const token = auth.replace('Bearer ', '').trim();

    if (!token) {
      return res.status(401).json({ error: 'Missing API token' });
    }

    const result = await pool.query(
      'SELECT id FROM users WHERE api_key = $1 LIMIT 1;',
      [token]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Invalid API token' });
    }

    req.user = { id: result.rows[0].id };
    next();
  } catch (err) {
    console.error('Error in apiAuth middleware:', err);
    res.status(500).json({ error: 'Auth error' });
  }
}



/** ---------- API v1 Router ---------- **/
const createApiV1 = require('./api-v1');
const apiV1 = createApiV1(pool);        // only pass pool now

// protect all /api/v1 routes with API key auth
app.use('/api/v1', apiAuth, apiV1);



// GET /api/carrier-search?q=...
// Returns top 10 matches for DOT / MC / name
app.get('/api/carrier-search', async (req, res) => {
  const q = (req.query.q || '').trim();

  // Require at least 2 chars, like the front-end
  if (q.length < 2) {
    return res.json([]);
  }

  const isNumeric  = /^\d+$/.test(q);
  const likePrefix = q + '%';
  const nameLike   = '%' + q.toLowerCase() + '%';

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
        (
          $1::boolean
          AND (
            dotnumber::text ILIKE $2
            OR mc_number::text ILIKE $2
          )
        )
        OR
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
        isNumeric,   // $1
        likePrefix,  // $2
        nameLike     // $3
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

    // clean + dedupe (numeric only)
    const uniqueDots = [...new Set(
      dots
        .map(d => String(d).trim())
        .filter(d => d && /^\d+$/.test(d))
    )];

    if (uniqueDots.length === 0) {
      return res.status(400).json({ error: 'No valid DOT numbers found' });
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
    console.error('Error in POST /api/my-carriers/bulk:', err);
    return res.status(500).json({ error: 'Failed to bulk add carriers' });
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



app.get("/api/_debug/spaces", async (req, res) => {
  try {
    const AWS = require("aws-sdk");

    const s3 = new AWS.S3({
      endpoint: `https://${process.env.SPACES_REGION}.digitaloceanspaces.com`,
      accessKeyId: process.env.SPACES_KEY,
      secretAccessKey: process.env.SPACES_SECRET,
      s3ForcePathStyle: true,
      signatureVersion: "v4"
    });

    const result = await s3.listObjectsV2({
      Bucket: process.env.SPACES_BUCKET,
      MaxKeys: 5
    }).promise();

    res.json({ ok: true, objects: result.Contents || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});



/** ---------- CONTRACT LANDING PAGE (token) ---------- **/
app.get("/contract/:token", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).send("Missing token");

  try {
    // 1) Validate token exists + not expired
    const { rows } = await pool.query(
      `
      SELECT contract_id, token_expires_at, status
      FROM public.contracts
      WHERE token = $1
      LIMIT 1;
      `,
      [token]
    );

    if (rows.length === 0) return res.status(404).send("Invalid link");

    const expires = rows[0].token_expires_at;
    if (expires && new Date(expires) < new Date()) {
      return res.status(410).send("This link has expired");
    }

    // 2) Flip to VIEWED (lightweight version)
    await pool.query(
      `
      UPDATE public.contracts
      SET status = 'VIEWED', updated_at = NOW()
      WHERE token = $1 AND status <> 'VIEWED';
      `,
      [token]
    );

    // 3) Branded page embedding the PDF route that already works
    const pdfUrl = `/contract/${encodeURIComponent(token)}/pdf`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(`
<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Carrier Agreement</title>
  <style>
    body { margin:0; font-family: Arial, sans-serif; background:#0b1220; color:#e6eefc; }
    .wrap { max-width: 980px; margin: 0 auto; padding: 20px; }
    .top { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
    .brand { font-weight:800; letter-spacing:0.2px; }
    .btn { display:inline-block; padding:10px 14px; border-radius:10px; background:#2b6cff; color:#fff; text-decoration:none; font-weight:700; }
    .card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 12px; }
    iframe { width:100%; height: 78vh; border:0; border-radius: 12px; background:#fff; }
    .muted { opacity:0.85; font-size: 13px; margin-top:10px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div class="brand">Carrier Shark — Carrier Agreement</div>
      <a class="btn" href="${pdfUrl}" target="_blank" rel="noopener">Open PDF</a>
    </div>

    <div class="card">
      <iframe src="${pdfUrl}"></iframe>
      <div class="muted">If the PDF doesn’t display on your device, tap “Open PDF”.</div>
    </div>
  </div>
</body>
</html>
    `);
  } catch (err) {
    console.error("GET /contract/:token error:", err?.message, err);
    return res.status(500).send("Server error");
  }
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

