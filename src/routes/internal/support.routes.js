"use strict";

const express = require("express");
const router = express.Router();

// GET tickets for the logged-in user
router.get("/support/tickets", async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const userId = req.session.userId;

  try {
    const { rows } = await req.db.query(
      `
      SELECT id, subject, created_at, status
      FROM support_tickets
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 25
      `,
      [userId]
    );

    res.json({ tickets: rows });
  } catch (e) {
    console.error("GET /support/tickets error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// POST create ticket (send email later / optional)
router.post("/support/tickets", async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const userId = req.session.userId;

  const contact_email = String(req.body?.contact_email || "").trim();
  const contact_phone = String(req.body?.contact_phone || "").trim();
  const subject = String(req.body?.subject || "").trim();
  const message = String(req.body?.message || "").trim();

  if (!contact_email || !contact_email.includes("@")) {
    return res.status(400).json({ error: "Enter a valid contact email." });
  }
  if (subject.length < 3) {
    return res.status(400).json({ error: "Subject is too short." });
  }
  if (message.length < 10) {
    return res.status(400).json({ error: "Message is too short." });
  }

  try {
    const { rows } = await req.db.query(
      `
      INSERT INTO support_tickets (user_id, contact_email, contact_phone, subject, message)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
      `,
      [userId, contact_email, contact_phone || null, subject, message]
    );

    const ticketId = rows[0].id;

    // (Optional) Email send happens here later once stable
    // await sendSupportTicketEmail(...)

    res.json({ ticket_id: ticketId });
  } catch (e) {
    console.error("POST /support/tickets error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
