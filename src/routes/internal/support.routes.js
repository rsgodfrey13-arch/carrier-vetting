"use strict";

const express = require("express");
// IMPORTANT: do NOT require ../../db/pool here
// Use the injected pool from internalRoutes({ pool })

function supportRoutes({ pool }) {
  if (!pool || typeof pool.query !== "function") {
    throw new Error("supportRoutes() requires a Postgres pool");
  }

  const router = express.Router();

  function getUserId(req) {
    // Match your session auth (fallbacks included)
    return (
      req.user?.id ||
      req.session?.userId ||
      req.session?.user?.id ||
      req.session?.user?.userId ||
      null
    );
  }

  // Optional: a quick debug endpoint (remove later)
  router.get("/support/_whoami", (req, res) => {
    res.json({
      user: req.user || null,
      sessionKeys: req.session ? Object.keys(req.session) : null,
      userId: getUserId(req),
    });
  });

  router.get("/support/tickets", async (req, res) => {
    try {
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
    } catch (err) {
      console.error("GET /support/tickets failed:", err);
      res.status(500).json({ error: "Failed to load tickets." });
    }
  });

const { sendSupportTicketEmail } = require("../../clients/mailgun");
  
  router.post("/support/tickets", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

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

      const { rows } = await pool.query(
        `
        INSERT INTO support_tickets (user_id, contact_email, contact_phone, subject, message)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        `,
        [userId, contact_email, contact_phone || null, subject, message]
      );

      res.json({ ticket_id: rows[0].id });
    } catch (err) {
      console.error("POST /support/tickets failed:", err);
      res.status(500).json({ error: "Failed to create ticket." });
    }
  });

  return router;
}

module.exports = { supportRoutes };
