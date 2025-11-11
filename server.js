const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(__dirname)); // serves index.html, style1.css, carrier.html, etc.

// Postgres connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// API – all carriers
app.get('/api/carriers', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM carriers;');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// API – single carrier by DOT (optional but nice)
app.get('/api/carriers/:dot', async (req, res) => {
  try {
    const dot = req.params.dot;
    const result = await pool.query(
      'SELECT * FROM carriers WHERE dot = $1;',
      [dot]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Carrier not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// Carrier profile page: /12345
// only match digits so /api/* and other paths still work
app.get('/:dot(\\d+)', (req, res) => {
  res.sendFile(path.join(__dirname, 'carrier.html'));
});

app.listen(port, () => console.log(`Server running on port ${port}`));
