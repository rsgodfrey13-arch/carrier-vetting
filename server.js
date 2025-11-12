const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Serve static files (index.html, carrier.html, style1.css, etc.)
app.use(express.static(__dirname));

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

/**
 * ALL CARRIERS – used by the home page table
 */
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
 * SINGLE CARRIER – used by /12345 page (carrier.html)
 * We look up by id, but still alias id -> dot in the response.
 */
app.get('/api/carriers/:dot', async (req, res) => {
  try {
    const dot = req.params.dot;

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
      WHERE dotnumber = $1;
    `, [dot]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Carrier not found' });
    }

    res.json(result.rows[0]);
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
