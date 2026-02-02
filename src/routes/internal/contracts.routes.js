"use strict";

const express = require("express");
const crypto = require("crypto");

const { pool } = require("../../db/pool");
const { requireAuth } = require("../../middleware/requireAuth");
const { sendContractEmail } = require("../../clients/mailgun");

const { spaces } = require("../../clients/spacesS3v2");


const router = express.Router();

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

/** ---------- CONTRACT TEMPLATES (broker-side) ---------- **/
router.get("/user-contracts", requireAuth, async (req, res) => {
  const userId = req.session.userId;

  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        name,
        version,
        storage_provider,
        storage_key,
        created_at
      FROM public.user_contracts
      WHERE user_id = $1
      ORDER BY created_at DESC;
      `,
      [userId]
    );

    res.json({ rows });
  } catch (err) {
    console.error("GET /api/user-contracts error:", err);
    res.status(500).json({ error: "Failed to load contract templates" });
  }
});

/** ---------- CONTRACT TEMPLATE PDF (broker-side preview) ---------- **/
router.get("/user-contracts/:id/pdf", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const templateId = String(req.params.id || "").trim();
  if (!templateId) return res.status(400).send("Missing template id");

  try {
    const { rows } = await pool.query(
      `
      SELECT
        storage_provider,
        storage_key,
        name
      FROM public.user_contracts
      WHERE id = $1
        AND user_id = $2
      LIMIT 1;
      `,
      [templateId, userId]
    );

    if (rows.length === 0) return res.status(404).send("Not found");

    const row = rows[0];

    if (row.storage_provider !== "DO_SPACES") {
      return res.status(500).send("Storage provider not configured");
    }
    if (!row.storage_key) {
      return res.status(500).send("Missing storage key");
    }

    const Bucket = process.env.SPACES_BUCKET;
    const Key = row.storage_key;

    // Stream from Spaces
    const obj = spaces.getObject({ Bucket, Key }).createReadStream();

    obj.on("error", (err) => {
      console.error("SPACES getObject error:", err?.code, err?.message, err);
      if (err?.code === "NoSuchKey") return res.status(404).send("PDF not found");
      return res.status(500).send("Failed to load PDF");
    });

    const safeName = String(row.name || "contract")
      .replace(/[^\w\-]+/g, "_")
      .slice(0, 60);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${safeName}.pdf"`
    );
    // Private caching is fine for broker-side templates
    res.setHeader("Cache-Control", "private, max-age=300");

    obj.pipe(res);
  } catch (err) {
    console.error("GET /api/user-contracts/:id/pdf error:", err?.message, err);
    return res.status(500).send("Server error");
  }
});



/** ---------- CONTRACT SEND ROUTE ---------- **/
router.post("/contracts/send/:dot", requireAuth, async (req, res) => {
  const dotnumber = req.params.dot;
  const { user_contract_id, email_to } = req.body || {};
  const user_id = req.session.userId;

  if (!user_contract_id || !email_to) {
    return res.status(400).json({
      error: "user_contract_id and email_to are required"
    });
  }

  const token = makeToken();
  const token_expires_at = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const link = `https://carriershark.com/contract/${token}`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const templateCheck = await client.query(
      `
      SELECT 1
      FROM public.user_contracts
      WHERE id = $1
        AND user_id = $2
        AND storage_provider = 'DO_SPACES'
        AND storage_key IS NOT NULL
      `,
      [user_contract_id, user_id]
    );

    if (templateCheck.rowCount === 0) {
      throw Object.assign(new Error("Invalid or unauthorized contract template"), {
        statusCode: 400
      });
    }

    const insertSql = `
      INSERT INTO public.contracts
        (
          user_id,
          dotnumber,
          status,
          channel,
          provider,
          payload,
          sent_at,
          token,
          token_expires_at,
          email_to,
          user_contract_id
        )
      VALUES
        (
          $1,
          $2,
          'SENT',
          'EMAIL',
          'MAILGUN',
          '{}'::jsonb,
          NOW(),
          $3,
          $4,
          $5,
          $6
        )
      RETURNING contract_id;
    `;

    const { rows } = await client.query(insertSql, [
      user_id,
      dotnumber,
      token,
      token_expires_at.toISOString(),
      email_to,
      user_contract_id
    ]);

    const contract_id = rows[0]?.contract_id;
    if (!contract_id) throw new Error("Failed to create contract");

    await sendContractEmail({
      to: email_to,
      dotnumber,
      link
    });

    await client.query("COMMIT");

    return res.json({
      ok: true,
      contract_id,
      status: "SENT",
      link
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("SEND CONTRACT ERROR:", err);

    return res.status(err.statusCode || 500).json({
      error: err.message || "Failed to send contract"
    });
  } finally {
    client.release();
  }
});

/** ---------- LATEST CONTRACT FOR DOT (broker-side) ---------- **/
router.get("/contracts/latest/:dot", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const dotnumber = String(req.params.dot || "").trim();

  if (!dotnumber) return res.status(400).json({ error: "dot is required" });

  try {
    const { rows } = await pool.query(
      `
      SELECT
        c.contract_id,
        c.user_id,
        c.dotnumber,
        c.status,
        c.channel,
        c.provider,
        c.email_to,
        c.sent_at,
        c.signed_at,
        c.created_at,
        c.updated_at,
        c.user_contract_id,
        uc.name AS contract_name,
        uc.version AS contract_version,
        ca.method AS acceptance_method,
        ca.accepted_at,
        ca.accepted_name,
        ca.accepted_title,
        ca.accepted_email,
        ca.accepted_ip
      FROM public.contracts c
      LEFT JOIN public.user_contracts uc
        ON uc.id = c.user_contract_id
      LEFT JOIN public.contract_acceptances ca
        ON ca.contract_id = c.contract_id
      WHERE c.user_id = $1
        AND c.dotnumber = $2
      ORDER BY c.created_at DESC
      LIMIT 1;
      `,
      [userId, dotnumber]
    );

    if (rows.length === 0) return res.json({ row: null });

    res.json({ row: rows[0] });
  } catch (err) {
    console.error("GET /api/contracts/latest/:dot error:", err);
    res.status(500).json({ error: "Failed to load latest contract" });
  }
});

router.get("/contracts/:dot", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const dotnumber = String(req.params.dot || "").trim();

  try {
    const { rows } = await pool.query(
      `
      SELECT
        contract_id, status, email_to, sent_at, created_at, updated_at, user_contract_id
      FROM public.contracts
      WHERE user_id = $1 AND dotnumber = $2
      ORDER BY created_at DESC
      LIMIT 50;
      `,
      [userId, dotnumber]
    );

    res.json({ rows });
  } catch (err) {
    console.error("GET /api/contracts/:dot error:", err);
    res.status(500).json({ error: "Failed to load contract history" });
  }
});


// ---------- DEFAULT CONTRACT TEMPLATE ----------
router.get("/agreements/default", requireAuth, async (req, res) => {
  const userId = req.session.userId;

  try {
    const { rows } = await pool.query(
      `
      SELECT
        d.default_user_contract_id,
        uc.name,
        uc.version,
        uc.created_at
      FROM public.user_contract_defaults d
      JOIN public.user_contracts uc
        ON uc.id = d.default_user_contract_id
      WHERE d.user_id = $1
      LIMIT 1;
      `,
      [userId]
    );

    if (rows.length === 0) return res.json({ row: null });
    return res.json({ row: rows[0] });
  } catch (err) {
    console.error("GET /api/agreements/default error:", err);
    return res.status(500).json({ error: "Failed to load default agreement" });
  }
});


router.post("/agreements/default", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { user_contract_id } = req.body || {};

  if (!user_contract_id) {
    return res.status(400).json({ error: "user_contract_id is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // validate template belongs to user
    const ok = await client.query(
      `
      SELECT 1
      FROM public.user_contracts
      WHERE id = $1 AND user_id = $2
      LIMIT 1;
      `,
      [user_contract_id, userId]
    );

    if (ok.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Invalid template (not yours)" });
    }

    // upsert default
    await client.query(
      `
      INSERT INTO public.user_contract_defaults (user_id, default_user_contract_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id)
      DO UPDATE SET
        default_user_contract_id = EXCLUDED.default_user_contract_id,
        updated_at = NOW();
      `,
      [userId, user_contract_id]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, default_user_contract_id: user_contract_id });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("POST /api/agreements/default error:", err);
    return res.status(500).json({ error: "Failed to set default agreement" });
  } finally {
    client.release();
  }
});





module.exports = router;
