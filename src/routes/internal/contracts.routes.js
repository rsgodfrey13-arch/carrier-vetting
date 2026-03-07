"use strict";

const express = require("express");
const crypto = require("crypto");
const multer = require("multer");

const { pool } = require("../../db/pool");
const { requireAuth } = require("../../middleware/requireAuth");
const { loadCompanyContext } = require("../../middleware/companyContext");
const { sendContractEmail } = require("../../clients/mailgun");

const { spaces } = require("../../clients/spacesS3v2");


const router = express.Router();
const carrierDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

/** ---------- CONTRACT TEMPLATES (broker-side) ---------- **/
router.get("/user-contracts", requireAuth, loadCompanyContext, async (req, res) => {
  const companyId = req.companyContext.companyId;

  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        name,
        version,
        storage_provider,
        storage_key,
        created_at,
        COALESCE(insurance_required, FALSE) AS insurance_required,
        COALESCE(w9_required, TRUE) AS w9_required,
        COALESCE(ach_required, FALSE) AS ach_required
      FROM public.user_contracts
      WHERE company_id = $1
      ORDER BY created_at DESC;
      `,
      [companyId]
    );

    res.json({ rows });
  } catch (err) {
    console.error("GET /api/user-contracts error:", err);
    res.status(500).json({ error: "Failed to load contract templates" });
  }
});

/** ---------- CONTRACT TEMPLATE PDF (broker-side preview) ---------- **/
router.get("/user-contracts/:id/pdf", requireAuth, loadCompanyContext, async (req, res) => {
  const companyId = req.companyContext.companyId;
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
        AND company_id = $2
      LIMIT 1;
      `,
      [templateId, companyId]
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
router.post("/contracts/send/:dot", requireAuth, loadCompanyContext, async (req, res) => {
  const dotnumber = req.params.dot;
  const { user_contract_id, email_to,carrier_name } = req.body || {};
  const user_id = req.session.userId;
  const companyId = req.companyContext.companyId;

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

const templateRes = await client.query(
  `
  SELECT
    name,
    display_name,
    COALESCE(insurance_required, FALSE) AS insurance_required,
    COALESCE(w9_required, TRUE) AS w9_required,
    COALESCE(ach_required, FALSE) AS ach_required
  FROM public.user_contracts
  WHERE id = $1
    AND company_id = $2
    AND storage_provider = 'DO_SPACES'
    AND storage_key IS NOT NULL
  LIMIT 1;
  `,
  [user_contract_id, companyId]
);

if (templateRes.rowCount === 0) {
  throw Object.assign(new Error("Invalid or unauthorized contract template"), {
    statusCode: 400
  });
}

const agreement_type = templateRes.rows[0].name || "Carrier Agreement";
const broker_name = templateRes.rows[0].display_name || "Carrier Agreement";
const insurance_required = templateRes.rows[0].insurance_required;
const w9_required = templateRes.rows[0].w9_required;
const ach_required = templateRes.rows[0].ach_required;


    const insertSql = `
      INSERT INTO public.contracts
        (
          user_id,
          company_id,
          dotnumber,
          status,
          channel,
          provider,
          payload,
          sent_at,
          token,
          token_expires_at,
          email_to,
          user_contract_id,
          insurance_required,
          w9_required,
          ach_required
        )
      VALUES
        (
          $1,
          $2,
          $3,
          'SENT',
          'EMAIL',
          'MAILGUN',
          $4::jsonb,
          NOW(),
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11
        )
      RETURNING contract_id;
    `;

    const { rows } = await client.query(insertSql, [
      user_id,
      companyId,
      dotnumber,
      JSON.stringify({ broker_name, agreement_type }),
      token,
      token_expires_at.toISOString(),
      email_to,
      user_contract_id,
      insurance_required,
      w9_required,
      ach_required
    ]);


    const contract_id = rows[0]?.contract_id;
    if (!contract_id) throw new Error("Failed to create contract");

    await sendContractEmail({
      to: email_to,
      broker_name,
      carrier_name: carrier_name || "", // optional for now
      dotnumber: String(dotnumber),
      agreement_type,
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

router.patch("/user-contracts/:id/requirements", requireAuth, loadCompanyContext, async (req, res) => {
  const companyId = req.companyContext.companyId;
  const templateId = String(req.params.id || "").trim();

  if (!templateId) return res.status(400).json({ error: "Missing template id" });

  const insurance_required = req.body?.insurance_required;
  const w9_required = req.body?.w9_required;
  const ach_required = req.body?.ach_required;

  if (
    typeof insurance_required !== "boolean" ||
    typeof w9_required !== "boolean" ||
    typeof ach_required !== "boolean"
  ) {
    return res.status(400).json({
      error: "insurance_required, w9_required, and ach_required must be boolean",
    });
  }

  try {
    const { rows } = await pool.query(
      `
      UPDATE public.user_contracts
      SET
        insurance_required = $1,
        w9_required = $2,
        ach_required = $3
      WHERE id = $4
        AND company_id = $5
      RETURNING
        id,
        insurance_required,
        w9_required,
        ach_required
      `,
      [insurance_required, w9_required, ach_required, templateId, companyId]
    );

    if (!rows.length) return res.status(404).json({ error: "Template not found" });

    return res.json({ ok: true, row: rows[0] });
  } catch (err) {
    console.error("PATCH /api/user-contracts/:id/requirements error:", err?.message, err);
    return res.status(500).json({ error: "Failed to update agreement requirements" });
  }
});


/** ---------- LATEST CONTRACT FOR DOT (broker-side) ---------- **/
router.get("/contracts/latest/:dot", requireAuth, loadCompanyContext, async (req, res) => {
  const companyId = req.companyContext.companyId;
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
      WHERE c.company_id = $1
        AND c.dotnumber = $2
      ORDER BY c.created_at DESC
      LIMIT 1;
      `,
      [companyId, dotnumber]
    );

    if (rows.length === 0) return res.json({ row: null });

    res.json({ row: rows[0] });
  } catch (err) {
    console.error("GET /api/contracts/latest/:dot error:", err);
    res.status(500).json({ error: "Failed to load latest contract" });
  }
});

router.get("/contracts/:dot", requireAuth, loadCompanyContext, async (req, res) => {
  const companyId = req.companyContext.companyId;
  const dotnumber = String(req.params.dot || "").trim();

  try {
    const { rows } = await pool.query(
      `
      SELECT
        contract_id, status, email_to, sent_at, created_at, updated_at, user_contract_id
      FROM public.contracts
      WHERE company_id = $1 AND dotnumber = $2
      ORDER BY created_at DESC
      LIMIT 50;
      `,
      [companyId, dotnumber]
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


async function loadSessionCompanyId(userId) {
  const userRes = await pool.query(
    `
    SELECT default_company_id company_id
    FROM public.users
    WHERE id = $1
    LIMIT 1
    `,
    [userId]
  );

  return userRes.rows[0]?.company_id || null;
}

function normalizeUploadedByRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "user" || normalized === "system") return normalized;
  return "carrier";
}

function toSafeStoragePart(value, fallback = "document") {
  const safe = String(value || "")
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return safe || fallback;
}

function normalizeCarrierDocumentRow(row, pdfLabel) {
  if (!row) return null;
  return {
    id: row.id,
    created_at: row.created_at,
    uploaded_at: row.created_at,
    original_filename: row.original_filename || null,
    mime_type: row.mime_type || null,
    uploaded_by_role: normalizeUploadedByRole(row.uploaded_by_role || row.source),
    uploaded_by_user_id: row.uploaded_by_user_id || null,
    uploaded_by_name: row.uploaded_by_name || null,
    uploaded_by_email: row.uploaded_by_email || null,
    source: normalizeUploadedByRole(row.uploaded_by_role || row.source),
    pdf_url: row.pdf_url,
    pdf_label: pdfLabel,
    certificate_url: row.certificate_url || null,
  };
}

function normalizeCarrierDocumentRows(rows, pdfLabel) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows
    .map((row) => normalizeCarrierDocumentRow(row, pdfLabel))
    .filter(Boolean);
}

async function ensureCarrierDocumentsTable() {
  await pool.query(
    `
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS public.carrier_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL,
      contract_id UUID NULL REFERENCES public.contracts(contract_id) ON DELETE CASCADE,
      dot_number TEXT NOT NULL,
      document_type TEXT NOT NULL CHECK (document_type IN ('w9', 'ach', 'other')),
      uploaded_by_role TEXT NOT NULL DEFAULT 'user' CHECK (uploaded_by_role IN ('carrier', 'user', 'system')),
      uploaded_by_user_id BIGINT NULL,
      uploaded_by_name TEXT NULL,
      uploaded_by_email TEXT NULL,
      storage_key TEXT NOT NULL,
      certificate_storage_key TEXT NULL,
      mime_type TEXT NOT NULL,
      certificate_mime_type TEXT NULL,
      original_filename TEXT NULL,
      certificate_original_filename TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE public.carrier_documents
      ADD COLUMN IF NOT EXISTS contract_id UUID;

    CREATE INDEX IF NOT EXISTS idx_carrier_documents_company_dot_created
      ON public.carrier_documents (company_id, dot_number, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_carrier_documents_contract_id
      ON public.carrier_documents (contract_id);
    `
  );
}

function buildCarrierDocumentStorageKey({ companyId, dot, documentType, originalFilename }) {
  const safeFileName = toSafeStoragePart(originalFilename || 'document');
  return `carrier-documents/${companyId}/${dot}/${documentType}/${Date.now()}_${safeFileName}`;
}

async function streamSpaceObjectToResponse({ res, key, fallbackFilename }) {
  const Bucket = process.env.SPACES_BUCKET;
  const stream = spaces.getObject({ Bucket, Key: key }).createReadStream();

  stream.on('error', (err) => {
    console.error('carrier document getObject error:', err?.code, err?.message, err);
    if (!res.headersSent) {
      if (err?.code === 'NoSuchKey') return res.status(404).send('Document not found');
      return res.status(500).send('Failed to load document');
    }
  });

  const safeName = toSafeStoragePart(fallbackFilename || 'carrier_document');
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  stream.pipe(res);
}

router.get('/carrier-documents/:dot', requireAuth, loadCompanyContext, async (req, res) => {
  try {
    const dot = String(req.params.dot || '').replace(/\D/g, '');
    if (!dot) return res.status(400).json({ error: 'Invalid DOT' });

    const companyId = req.companyContext.companyId;
    await ensureCarrierDocumentsTable();

    const [w9Res, achRes, otherRes, userDocsRes] = await Promise.all([
      pool.query(
        `
        SELECT cwd.id, cwd.created_at, cwd.original_filename, cwd.mime_type, c.token
        FROM public.contract_w9_documents cwd
        JOIN public.contracts c ON c.contract_id::text = cwd.contract_id::text
        WHERE c.company_id::text = $1::text
          AND REGEXP_REPLACE(COALESCE(c.dotnumber::text, ''), '\D', '', 'g') = $2
          AND c.status IN ('ACKNOWLEDGED', 'SIGNED')
        `,
        [companyId, dot]
      ),
      pool.query(
        `
        SELECT cad.id, cad.created_at, cad.original_filename, cad.mime_type, c.token
        FROM public.contract_ach_documents cad
        JOIN public.contracts c ON c.contract_id::text = cad.contract_id::text
        WHERE c.company_id::text = $1::text
          AND REGEXP_REPLACE(COALESCE(c.dotnumber::text, ''), '\D', '', 'g') = $2
          AND c.status IN ('ACKNOWLEDGED', 'SIGNED')
        `,
        [companyId, dot]
      ),
      pool.query(
        `
        SELECT cod.id, cod.created_at, cod.original_filename, cod.mime_type, c.token
        FROM public.contract_other_documents cod
        JOIN public.contracts c ON c.contract_id::text = cod.contract_id::text
        WHERE c.company_id::text = $1::text
          AND REGEXP_REPLACE(COALESCE(c.dotnumber::text, ''), '\D', '', 'g') = $2
          AND c.status IN ('ACKNOWLEDGED', 'SIGNED')
        `,
        [companyId, dot]
      ),
      pool.query(
        `
        SELECT id, created_at, original_filename, mime_type, document_type,
               uploaded_by_role, uploaded_by_user_id, uploaded_by_name,
               uploaded_by_email, certificate_storage_key
        FROM public.carrier_documents
        WHERE company_id = $1
          AND REGEXP_REPLACE(COALESCE(dot_number, ''), '\D', '', 'g') = $2
        `,
        [companyId, dot]
      ),
    ]);

    const docs = [
      ...normalizeCarrierDocumentRows((w9Res.rows || []).map((row) => ({
        ...row,
        type: 'W-9',
        uploaded_by_role: 'carrier',
        pdf_url: `/contract/${row.token}/w9`,
      })), 'View Document'),
      ...normalizeCarrierDocumentRows((achRes.rows || []).map((row) => ({
        ...row,
        type: 'ACH',
        uploaded_by_role: 'carrier',
        pdf_url: `/contract/${row.token}/ach`,
        certificate_url: `/contract/${row.token}/certificate`,
      })), 'View Document'),
      ...normalizeCarrierDocumentRows((otherRes.rows || []).map((row) => ({
        ...row,
        type: 'Other',
        uploaded_by_role: 'carrier',
        pdf_url: `/contract/${row.token}/other/${row.id}`,
      })), 'View Document'),
      ...normalizeCarrierDocumentRows((userDocsRes.rows || []).map((row) => ({
        ...row,
        type: row.document_type === 'w9' ? 'W-9' : row.document_type === 'ach' ? 'ACH' : 'Other',
        pdf_url: `/api/carrier-documents/${dot}/platform/${row.id}/file`,
        certificate_url: row.certificate_storage_key ? `/api/carrier-documents/${dot}/platform/${row.id}/certificate` : null,
      })), 'View Document'),
    ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    const counts = docs.reduce((acc, doc) => {
      const key = doc.type === 'W-9' ? 'w9' : doc.type === 'ACH' ? 'ach' : 'other';
      acc[key] += 1;
      return acc;
    }, { w9: 0, ach: 0, other: 0 });

    return res.json({
      count: docs.length,
      counts,
      documents: docs,
    });
  } catch (err) {
    console.error('GET /carrier-documents/:dot error:', err?.message, err);
    return res.status(500).json({ error: 'Failed to load carrier documents' });
  }
});

router.post('/carrier-documents/:dot/upload', requireAuth, loadCompanyContext, carrierDocumentUpload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'certificate', maxCount: 1 },
]), async (req, res) => {
  try {
    const dot = String(req.params.dot || '').replace(/\D/g, '');
    if (!dot) return res.status(400).json({ error: 'Invalid DOT' });

    const companyId = req.companyContext.companyId;
    const userId = req.session.userId;
    const docType = String(req.body?.document_type || '').trim().toLowerCase();
    if (!['w9', 'ach', 'other'].includes(docType)) {
      return res.status(400).json({ error: 'document_type must be w9, ach, or other' });
    }

    const file = req.files?.file?.[0];
    if (!file) return res.status(400).json({ error: 'A file is required' });

    const mimeType = String(file.mimetype || '').toLowerCase().trim();
    if (!ALLOWED_DOCUMENT_MIME_TYPES.has(mimeType)) {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    const certFile = req.files?.certificate?.[0] || null;
    if (docType !== 'ach' && certFile) {
      return res.status(400).json({ error: 'Certificate upload is only supported for ACH documents' });
    }

    if (certFile) {
      const certMime = String(certFile.mimetype || '').toLowerCase().trim();
      if (!ALLOWED_DOCUMENT_MIME_TYPES.has(certMime)) {
        return res.status(400).json({ error: 'Unsupported certificate file type' });
      }
    }

    await ensureCarrierDocumentsTable();

    const [userRes] = await Promise.all([
      pool.query(`SELECT name, email FROM public.users WHERE id = $1 LIMIT 1`, [userId]),
    ]);
    const user = userRes.rows[0] || {};

    const mainKey = buildCarrierDocumentStorageKey({
      companyId,
      dot,
      documentType: docType,
      originalFilename: file.originalname,
    });

    await spaces.putObject({
      Bucket: process.env.SPACES_BUCKET,
      Key: mainKey,
      Body: file.buffer,
      ContentType: mimeType,
      ACL: 'private',
      Metadata: {
        company_id: String(companyId),
        dot_number: dot,
        document_type: docType,
        uploaded_by_role: 'user',
      },
    }).promise();

    let certKey = null;
    let certMimeType = null;
    let certOriginalFilename = null;

    if (certFile) {
      certMimeType = String(certFile.mimetype || '').toLowerCase().trim();
      certOriginalFilename = certFile.originalname || 'certificate';
      certKey = buildCarrierDocumentStorageKey({
        companyId,
        dot,
        documentType: `${docType}/certificate`,
        originalFilename: certOriginalFilename,
      });

      await spaces.putObject({
        Bucket: process.env.SPACES_BUCKET,
        Key: certKey,
        Body: certFile.buffer,
        ContentType: certMimeType,
        ACL: 'private',
        Metadata: {
          company_id: String(companyId),
          dot_number: dot,
          document_type: docType,
          uploaded_by_role: 'user',
          is_certificate: 'true',
        },
      }).promise();
    }

    
const contractId = req.body?.contract_id ? String(req.body.contract_id).trim() : null;

const inserted = await pool.query(
  `
  INSERT INTO public.carrier_documents (
    company_id,
    contract_id,
    dot_number,
    document_type,
    uploaded_by_role,
    uploaded_by_user_id,
    uploaded_by_name,
    uploaded_by_email,
    storage_key,
    certificate_storage_key,
    mime_type,
    certificate_mime_type,
    original_filename,
    certificate_original_filename
  )
  VALUES
    ($1, $2, $3, 'user', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  RETURNING id, created_at, document_type, original_filename, mime_type,
            uploaded_by_role, uploaded_by_user_id, uploaded_by_name,
            uploaded_by_email, certificate_storage_key
  `,
  [
    String(companyId),
    contractId,
    dot,
    userId,
    user.name || null,
    user.email || null,
    mainKey,
    certKey,
    mimeType,
    certMimeType,
    file.originalname || null,
    certOriginalFilename,
  ]
);

    const row = inserted.rows[0];
    const document = normalizeCarrierDocumentRow({
      ...row,
      type: row.document_type === 'w9' ? 'W-9' : row.document_type === 'ach' ? 'ACH' : 'Other',
      pdf_url: `/api/carrier-documents/${dot}/platform/${row.id}/file`,
      certificate_url: row.certificate_storage_key ? `/api/carrier-documents/${dot}/platform/${row.id}/certificate` : null,
    }, 'View Document');

    return res.status(201).json({ ok: true, document });
  } catch (err) {
    console.error('POST /carrier-documents/:dot/upload error:', err?.message, err);
    return res.status(500).json({ error: 'Failed to upload document' });
  }
});

router.get('/carrier-documents/:dot/platform/:id/file', requireAuth, loadCompanyContext, async (req, res) => {
  try {
    const dot = String(req.params.dot || '').replace(/\D/g, '');
    const id = String(req.params.id || '').trim();
    if (!dot || !id) return res.status(400).send('Invalid document id');

    await ensureCarrierDocumentsTable();

    const q = await pool.query(
      `
      SELECT storage_key, mime_type, original_filename
      FROM public.carrier_documents
      WHERE id = $1
        AND company_id = $2
        AND REGEXP_REPLACE(COALESCE(dot_number, ''), '\D', '', 'g') = $3
      LIMIT 1
      `,
      [id, String(req.companyContext.companyId), dot]
    );

    const row = q.rows[0];
    if (!row?.storage_key) return res.status(404).send('Document not found');

    if (row.mime_type) res.setHeader('Content-Type', row.mime_type);
    return streamSpaceObjectToResponse({
      res,
      key: row.storage_key,
      fallbackFilename: row.original_filename || `carrier_document_${id}`
    });
  } catch (err) {
    console.error('GET /carrier-documents/:dot/platform/:id/file error:', err?.message, err);
    return res.status(500).send('Failed to load document');
  }
});

router.get('/carrier-documents/:dot/platform/:id/certificate', requireAuth, loadCompanyContext, async (req, res) => {
  try {
    const dot = String(req.params.dot || '').replace(/\D/g, '');
    const id = String(req.params.id || '').trim();
    if (!dot || !id) return res.status(400).send('Invalid document id');

    await ensureCarrierDocumentsTable();

    const q = await pool.query(
      `
      SELECT certificate_storage_key, certificate_mime_type, certificate_original_filename
      FROM public.carrier_documents
      WHERE id = $1
        AND company_id = $2
        AND REGEXP_REPLACE(COALESCE(dot_number, ''), '\D', '', 'g') = $3
      LIMIT 1
      `,
      [id, String(req.companyContext.companyId), dot]
    );

    const row = q.rows[0];
    if (!row?.certificate_storage_key) return res.status(404).send('Certificate not found');

    if (row.certificate_mime_type) res.setHeader('Content-Type', row.certificate_mime_type);
    return streamSpaceObjectToResponse({
      res,
      key: row.certificate_storage_key,
      fallbackFilename: row.certificate_original_filename || `carrier_document_certificate_${id}`
    });
  } catch (err) {
    console.error('GET /carrier-documents/:dot/platform/:id/certificate error:', err?.message, err);
    return res.status(500).send('Failed to load certificate');
  }
});

router.get("/carrier-agreements/:dot", async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const dot = String(req.params.dot || "").replace(/\D/g, "");
    if (!dot) {
      return res.status(400).json({ error: "Invalid DOT" });
    }

    const userId = req.session.userId;

    // get the caller's company_id
    const companyId = await loadSessionCompanyId(userId);
    if (!companyId) {
      return res.status(403).json({ error: "No company context found" });
    }

    // count signed/acknowledged agreements for this DOT only
    const countRes = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM public.contracts c
      WHERE c.company_id = $1
        AND REGEXP_REPLACE(COALESCE(c.dotnumber::text, ''), '\D', '', 'g') = $2
        AND c.status IN ('ACKNOWLEDGED', 'SIGNED')
      `,
      [companyId, dot]
    );

    const agreementsRes = await pool.query(
      `
      SELECT
        c.contract_id,
        c.token,
        c.status,
        c.signed_at,
        c.sent_at,
        c.created_at,
        uc.name AS agreement_type
      FROM public.contracts c
      LEFT JOIN public.user_contracts uc
        ON uc.id = c.user_contract_id
      WHERE c.company_id = $1
        AND REGEXP_REPLACE(COALESCE(c.dotnumber::text, ''), '\D', '', 'g') = $2
        AND c.status IN ('ACKNOWLEDGED', 'SIGNED')
      ORDER BY COALESCE(c.signed_at, c.sent_at, c.created_at) DESC
      `,
      [companyId, dot]
    );

    const count = countRes.rows[0]?.count || 0;
    const agreements = Array.isArray(agreementsRes.rows)
      ? agreementsRes.rows.map((agreement) => ({
          contract_id: agreement.contract_id,
          agreement_type: agreement.agreement_type || "Carrier Agreement",
          status: agreement.status,
          signed_at: agreement.signed_at,
          sent_at: agreement.sent_at,
          created_at: agreement.created_at,
          pdf_url: `/contract/${agreement.token}/pdf`,
          certificate_url: `/contract/${agreement.token}/certificate`,
        }))
      : [];

    return res.json({
      count,
      latest_signed_at: agreements[0]?.signed_at || null,
      agreements,
    });
  } catch (err) {
    console.error("GET /carrier-agreements/:dot error:", err?.message, err);
    return res.status(500).json({ error: "Failed to load carrier agreements" });
  }
});

router.get("/carrier-ach-documents/:dot", async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const dot = String(req.params.dot || "").replace(/\D/g, "");
    if (!dot) {
      return res.status(400).json({ error: "Invalid DOT" });
    }

    const userId = req.session.userId;

    const companyId = await loadSessionCompanyId(userId);
    if (!companyId) {
      return res.status(403).json({ error: "No company context found" });
    }

    const countRes = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM public.contract_ach_documents cad
      JOIN public.contracts c
        ON c.contract_id::text = cad.contract_id::text
      WHERE c.company_id::text = $1::text
        AND REGEXP_REPLACE(COALESCE(c.dotnumber::text, ''), '\D', '', 'g') = $2
        AND c.status IN ('ACKNOWLEDGED', 'SIGNED')
      `,
      [companyId, dot]
    );

    const documentsRes = await pool.query(
      `
      SELECT
        cad.id,
        cad.created_at,
        cad.original_filename,
        cad.mime_type,
        c.token
      FROM public.contract_ach_documents cad
      JOIN public.contracts c
        ON c.contract_id::text = cad.contract_id::text
      WHERE c.company_id::text = $1::text
        AND REGEXP_REPLACE(COALESCE(c.dotnumber::text, ''), '\D', '', 'g') = $2
        AND c.status IN ('ACKNOWLEDGED', 'SIGNED')
      ORDER BY cad.created_at DESC
      `,
      [companyId, dot]
    );

    const count = countRes.rows[0]?.count || 0;
    const documents = normalizeCarrierDocumentRows(
      (documentsRes.rows || []).map((row) => ({
        ...row,
        source: "carrier",
        pdf_url: `/contract/${row.token}/ach`,
        certificate_url: `/contract/${row.token}/certificate`,
      })),
      "View Document"
    );

    return res.json({
      count,
      documents,
    });
  } catch (err) {
    console.error("GET /carrier-ach-documents/:dot error:", err?.message, err);
    return res.status(500).json({ error: "Failed to load carrier ACH documents" });
  }
});



router.get("/carrier-w9-documents/:dot", async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const dot = String(req.params.dot || "").replace(/\D/g, "");
    if (!dot) {
      return res.status(400).json({ error: "Invalid DOT" });
    }

    const companyId = await loadSessionCompanyId(req.session.userId);
    if (!companyId) {
      return res.status(403).json({ error: "No company context found" });
    }

    const countRes = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM public.contract_w9_documents cwd
      JOIN public.contracts c
        ON c.contract_id::text = cwd.contract_id::text
      WHERE c.company_id::text = $1::text
        AND REGEXP_REPLACE(COALESCE(c.dotnumber::text, ''), '\D', '', 'g') = $2
        AND c.status IN ('ACKNOWLEDGED', 'SIGNED')
      `,
      [companyId, dot]
    );

    const documentsRes = await pool.query(
      `
      SELECT
        cwd.id,
        cwd.created_at,
        cwd.original_filename,
        cwd.mime_type,
        c.token
      FROM public.contract_w9_documents cwd
      JOIN public.contracts c
        ON c.contract_id::text = cwd.contract_id::text
      WHERE c.company_id::text = $1::text
        AND REGEXP_REPLACE(COALESCE(c.dotnumber::text, ''), '\D', '', 'g') = $2
        AND c.status IN ('ACKNOWLEDGED', 'SIGNED')
      ORDER BY cwd.created_at DESC
      `,
      [companyId, dot]
    );

    const count = countRes.rows[0]?.count || 0;
    const documents = normalizeCarrierDocumentRows(
      (documentsRes.rows || []).map((row) => ({
        ...row,
        source: "carrier",
        pdf_url: `/contract/${row.token}/w9`,
      })),
      "View Document"
    );

    return res.json({
      count,
      documents,
    });
  } catch (err) {
    console.error("GET /carrier-w9-documents/:dot error:", err?.message, err);
    return res.status(500).json({ error: "Failed to load carrier W9 documents" });
  }
});

router.get("/carrier-other-documents/:dot", async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const dot = String(req.params.dot || "").replace(/\D/g, "");
    if (!dot) {
      return res.status(400).json({ error: "Invalid DOT" });
    }

    const companyId = await loadSessionCompanyId(req.session.userId);
    if (!companyId) {
      return res.status(403).json({ error: "No company context found" });
    }

    const countRes = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM public.contract_other_documents cod
      JOIN public.contracts c
        ON c.contract_id::text = cod.contract_id::text
      WHERE c.company_id::text = $1::text
        AND REGEXP_REPLACE(COALESCE(c.dotnumber::text, ''), '\D', '', 'g') = $2
        AND c.status IN ('ACKNOWLEDGED', 'SIGNED')
      `,
      [companyId, dot]
    );

    const documentsRes = await pool.query(
      `
      SELECT
        cod.id,
        cod.created_at,
        cod.original_filename,
        cod.mime_type,
        c.token
      FROM public.contract_other_documents cod
      JOIN public.contracts c
        ON c.contract_id::text = cod.contract_id::text
      WHERE c.company_id::text = $1::text
        AND REGEXP_REPLACE(COALESCE(c.dotnumber::text, ''), '\D', '', 'g') = $2
        AND c.status IN ('ACKNOWLEDGED', 'SIGNED')
      ORDER BY cod.created_at DESC
      `,
      [companyId, dot]
    );

    const count = countRes.rows[0]?.count || 0;
    const documents = normalizeCarrierDocumentRows(
      (documentsRes.rows || []).map((row) => ({
        ...row,
        source: "carrier",
        pdf_url: `/contract/${row.token}/other/${row.id}`,
      })),
      "View Document"
    );

    return res.json({
      count,
      documents,
    });
  } catch (err) {
    console.error("GET /carrier-other-documents/:dot error:", err?.message, err);
    return res.status(500).json({ error: "Failed to load carrier other documents" });
  }
});

module.exports = router;
