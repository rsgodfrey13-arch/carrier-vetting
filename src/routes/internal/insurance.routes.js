"use strict";

const express = require("express");
const crypto = require("crypto");
const multer = require("multer");

const { pool } = require("../../db/pool");
const { s3 } = require("../../clients/spacesS3v3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");

const router = express.Router();

// ---- Multer: store in memory, validate PDF ----
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12MB
  fileFilter: (req, file, cb) => {
    const okMime = file.mimetype === "application/pdf";
    const okExt = (file.originalname || "").toLowerCase().endsWith(".pdf");
    if (!okMime && !okExt) return cb(new Error("Only PDF files are allowed."));
    cb(null, true);
  },
});

// helper: sanitize DOT
function normalizeDot(dot) {
  const cleaned = String(dot || "").replace(/\D/g, "");
  if (!cleaned) throw new Error("dot_number is required.");
  if (cleaned.length > 10) throw new Error("dot_number too long.");
  return cleaned;
}

function normalizeUploadedBy(v) {
  const x = String(v || "").toUpperCase().trim();
  if (x === "BROKER") return "CUSTOMER";
  if (x === "CARRIER") return "CARRIER";
  if (x === "AGENT") return "AGENT";
  if (x === "CUSTOMER") return "CUSTOMER";
  throw new Error("uploaded_by must be CARRIER, BROKER, AGENT, or CUSTOMER.");
}

function normalizeDocType(v) {
  const x = String(v || "COI").toUpperCase().trim();
  if (x === "COI" || x === "OTHER") return x;
  throw new Error("document_type must be COI or OTHER.");
}

/**
 * GET /api/insurance/latest?dot=123
 */
router.get("/insurance/latest", async (req, res) => {
  try {
    const dot = String(req.query.dot || "").replace(/\D/g, "");
    if (!dot) throw new Error("dot query param is required (numbers only).");

    const r = await pool.query(
      `
      SELECT id, dot_number, uploaded_by, document_type, status, uploaded_at, spaces_key
      FROM insurance_documents
      WHERE dot_number = $1
      ORDER BY uploaded_at DESC
      LIMIT 1
      `,
      [dot]
    );

    if (r.rowCount === 0) {
      return res.json({ ok: true, dot_number: dot, document: null });
    }

    const doc = r.rows[0];
    if (!doc.spaces_key) throw new Error("spaces_key is missing for this document.");

    const command = new GetObjectCommand({
      Bucket: process.env.SPACES_BUCKET,
      Key: doc.spaces_key,
      ResponseContentType: "application/pdf",
      ResponseContentDisposition: `inline; filename="COI-${doc.dot_number}.pdf"`
    });

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 60 * 10 });

    return res.json({
      ok: true,
      dot_number: dot,
      document: doc,
      signedUrl
    });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/insurance/documents  (multipart form-data: document=pdf, dot_number, uploaded_by, document_type)
 */
router.post("/insurance/documents", upload.single("document"), async (req, res) => {
  try {
    if (!req.file) throw new Error("document (PDF) is required.");

    const dot_number = normalizeDot(req.body.dot_number);
    const uploaded_by = normalizeUploadedBy(req.body.uploaded_by);
    const document_type = normalizeDocType(req.body.document_type);

    const rand = crypto.randomBytes(10).toString("hex");
    const key = `insurance/${dot_number}/${Date.now()}-${rand}.pdf`;

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.SPACES_BUCKET,
        Key: key,
        Body: req.file.buffer,
        ContentType: "application/pdf",
        ACL: "private",
        Metadata: { dot_number, uploaded_by, document_type }
      })
    );

    const file_url = `s3://${process.env.SPACES_BUCKET}/${key}`;

    const result = await pool.query(
      `
      INSERT INTO insurance_documents
        (dot_number, uploaded_by, file_url, spaces_key, file_type, document_type, status)
      VALUES
        ($1, $2, $3, $4, 'PDF', $5, 'ON_FILE')
      RETURNING id, dot_number, uploaded_by, file_url, spaces_key, file_type, document_type, status, uploaded_at
      `,
      [dot_number, uploaded_by, file_url, key, document_type]
    );

    return res.status(201).json({ ok: true, document: result.rows[0] });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message || "Upload failed" });
  }
});

/**
 * GET /api/insurance/documents?dot=123
 */
router.get("/insurance/documents", async (req, res) => {
  try {
    const dot = String(req.query.dot || "").replace(/\D/g, "");
    if (!dot) throw new Error("dot query param is required (numbers only).");

    const r = await pool.query(
      `
      SELECT id, dot_number, uploaded_by, document_type, status, uploaded_at
           , file_url, spaces_key
      FROM insurance_documents
      WHERE dot_number = $1
      ORDER BY uploaded_at DESC
      LIMIT 50
      `,
      [dot]
    );

    res.json({ ok: true, documents: r.rows });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/insurance/documents/:id/signed-url
 */
router.get("/insurance/documents/:id/signed-url", async (req, res) => {
  try {
    const { id } = req.params;

    const r = await pool.query(
      `
      SELECT id, dot_number, spaces_key, file_url
      FROM insurance_documents
      WHERE id = $1
      `,
      [id]
    );

    if (r.rowCount === 0) throw new Error("Document not found.");
    const doc = r.rows[0];
    if (!doc.spaces_key) throw new Error("spaces_key is missing for this document.");

    const command = new GetObjectCommand({
      Bucket: process.env.SPACES_BUCKET,
      Key: doc.spaces_key,
      ResponseContentType: "application/pdf"
    });

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 60 * 10 });

    res.json({ ok: true, id: doc.id, dot_number: doc.dot_number, signedUrl });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
