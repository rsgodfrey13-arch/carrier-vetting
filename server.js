const express = require('express');
const { Pool } = require('pg');
const app = express();
const port = process.env.PORT || 3000;

// Allow static HTML files to be served
app.use(express.static(__dirname));

// Connect to PostgreSQL using DigitalOcean’s env variable
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Example API endpoint
app.get('/api/carriers', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM carriers LIMIT 10;');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database query failed' });
  }
});

app.listen(port, () => console.log(`Server running on port ${port}`));
