"use strict";

const express = require("express");
const router = express.Router();

// account snapshot data for Account page
router.get("/account/overview", async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const userId = req.session.userId;

  const { rows } = await req.db.query(
    `
    SELECT
      u.name,
      u.email,
      u.company,
      u.email_alerts, u.rest_alerts, u.webhook_alerts, u.plan
    FROM users u
    WHERE u.id = $1
    `,
    [userId]
  );

  if (!rows.length) return res.status(404).json({ error: "User not found" });

  res.json(rows[0]);
});

// Get Email Alert Fields
router.get("/account/email-alert-fields", async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: "unauthorized" });

  const userId = req.session.userId;

  const { rows } = await req.db.query(
    `
    SELECT
      u.field_key,
      u.enabled,
      COALESCE(u.label, af.label, u.field_key) AS label,
      COALESCE(u.category, af.category, 'Other') AS category
    FROM public.user_email_alert_fields u
    LEFT JOIN public.alert_fields af
      ON af.field_key = u.field_key
    WHERE u.user_id = $1
    ORDER BY af.sort_order
    `,
    [userId]
  );

  res.json({ fields: rows });
});

// Save Email Alert Fields
router.post("/account/email-alert-fields", async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: "unauthorized" });

  const userId = req.session.userId;
  const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];

  for (const u of updates) {
    if (!u || typeof u.field_key !== "string" || typeof u.enabled !== "boolean") {
      return res.status(400).json({ error: "invalid payload" });
    }
  }

  if (!updates.length) return res.json({ ok: true, updated: 0 });

  const client = await req.db.connect();
  try {
    await client.query("BEGIN");

    for (const u of updates) {
      await client.query(
        `
        UPDATE public.user_email_alert_fields
        SET enabled = $3,
            updated_at = now()
        WHERE user_id = $1
          AND field_key = $2
        `,
        [userId, u.field_key, u.enabled]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true, updated: updates.length });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "server error" });
  } finally {
    client.release();
  }
});



module.exports = router;
