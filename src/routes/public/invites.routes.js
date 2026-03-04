"use strict";

const path = require("path");
const express = require("express");
const { pool } = require("../../db/pool");

const router = express.Router();

// Serve the accept invite page
router.get("/accept-invite/:token", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).send("Missing token");

  // Optional: validate invite exists so you can show a nicer error page
  try {
    const { rows } = await pool.query(
      `
      SELECT
        i.status,
        i.expires_at,
        c.name AS company_name
      FROM public.company_invites i
      JOIN public.companies c ON c.id = i.company_id
      WHERE i.token = $1
      LIMIT 1
      `,
      [token]
    );

    if (!rows.length) {
      return res.status(404).send("Invite not found.");
    }

    // Serve static HTML file
    return res.sendFile(
      path.join(__dirname, "../../public/accept-invite.html")
    );
  } catch (err) {
    console.error("GET /accept-invite/:token error:", err);
    return res.status(500).send("Server error");
  }
});

module.exports = router;
