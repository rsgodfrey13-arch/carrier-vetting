// routes/api/me.js
router.get("/me", requireAuth, async (req, res) => {
  const userId = req.user.id; // or req.session.user_id

  const row = await db.one(`
    SELECT
      u.name,
      u.email,
      c.name AS company
    FROM users u
    LEFT JOIN companies c ON c.id = u.company_id
    WHERE u.id = $1
  `, [userId]);

  res.json(row);
});
