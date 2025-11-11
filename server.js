const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// Serve your static files (HTML, JS, CSS) from the same folder
app.use(express.static(__dirname));

/**
 * 1) DIRECT Postgres connection settings for testing
 *    We'll hard-code these first to make sure everything works.
 *    In STEP 3 we'll switch back to DATABASE_URL for DigitalOcean.
 */
const pool = new Pool({
  host: 'carrier-vetting-do-user-27858216-0.e.db.ondigitalocean.com',
  port: 25060,                 // from DigitalOcean screen
  database: 'defaultdb',       // from DigitalOcean screen
  user: 'doadmin',             // from DigitalOcean screen
  password: 'AVNS_QZfAFA-4TzNXYII9lET',
  ssl: { rejectUnauthorized: false }
});

/**
 * 2) API endpoint used by your HTML: /api/carriers
 */
app.get('/api/carriers', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id        AS dot,
        address1,
        address2,
        city,
        state,
        zip
      FROM public.carriers
      ORDER BY id
      LIMIT 50;
    `);

    console.log('Rows from DB:', result.rows); // debug
    res.json(result.rows);
  } catch (err) {
    console.error('Error in /api/carriers:', err);
    res.status(500).json({ error: 'Database query failed' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
