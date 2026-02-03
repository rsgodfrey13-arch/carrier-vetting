"use strict";

const express = require("express");
const router = express.Router();

const pool = require("../../db/pool"); // adjust to your actual pool path
const { sendSupportTicketEmail } = require("../../clients/mailgun");

// NOTE: assumes you already have auth middleware for internal routes
// and you can access req.user (id/email). If your app uses something else,
// swap it in below.
function getUserId(req) {
  // Common patterns
  return (
    req.session?.userId ||
    req.session?.user?.id ||
    req.session?.user?.userId ||
    null
  );
}


router.get("/support/tickets", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { rows } = await pool.query(
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
});


router.post("/support/tickets", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const contact_email = String(req.body?.contact_email || "").trim();
  const contact_phone = String(req.body?.contact_phone || "").trim();
  const subject = String(req.body?.subject || "").trim();
  const message = String(req.body?.message || "").trim();

  // basic validation (tight + not annoying)
  if (!contact_email || !contact_email.includes("@")) {
    return res.status(400).json({ error: "Enter a valid contact email." });
  }
  if (subject.length < 3) {
    return res.status(400).json({ error: "Subject is too short." });
  }
  if (message.length < 10) {
    return res.status(400).json({ error: "Message is too short." });
  }

  const { rows } = await pool.query(
    `
    INSERT INTO support_tickets (user_id, contact_email, contact_phone, subject, message)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
    `,
    [me.id, contact_email, contact_phone || null, subject, message]
  );

  const ticketId = rows[0].id;

  // Send email to your inbox
  await sendSupportTicketEmail({
    to: "darkalerts@gmail.com",
    ticketId,
    contactEmail: contact_email,
    contactPhone: contact_phone || null,
    subject,
    message,
    userEmail: me.email || null,
  });

  res.json({ ticket_id: ticketId });
});

module.exports = router;
