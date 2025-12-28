"use strict";

const express = require("express");
const crypto = require("crypto");
const multer = require("multer");

const { pool } = require("../../db/pool");
const { s3 } = require("../../clients/spacesS3v3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");

const { parseAcord25FromText } = require("../../services/insurance/parseAcord25");
const { ocrPdfBufferWithTextract } = require("../../../ocr/textractPdf");



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

/**
 * POST /api/insurance/documents/:id/parse
 */
router.post("/insurance/documents/:id/parse", async (req, res) => {
  const client = await pool.connect();

  const forcedProvider = "TEXTRACT"; // keeping your hard-force behavior

  try {
    const { id } = req.params;

    // ---------- 0) Lock + idempotency ----------
    await client.query("BEGIN");

    const r = await client.query(
      `
      SELECT id, dot_number, spaces_key, ocr_status, ocr_provider, parse_result
      FROM insurance_documents
      WHERE id = $1
      FOR UPDATE
      `,
      [id]
    );

    if (r.rowCount === 0) throw new Error("Document not found.");

    const doc = r.rows[0];
    if (!doc.spaces_key) throw new Error("spaces_key missing for this document.");

    if (doc.ocr_status === "PROCESSING") {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok: false, error: "OCR already PROCESSING for this document." });
    }

    if (doc.ocr_status === "DONE" && doc.parse_result) {
      await client.query("ROLLBACK");
      return res.json({
        ok: true,
        document_id: id,
        dot_number: doc.dot_number,
        parseResult: doc.parse_result,
        reused: true
      });
    }

    await client.query(
      `
      UPDATE insurance_documents
      SET ocr_status='PROCESSING',
          ocr_started_at=NOW(),
          ocr_attempts = COALESCE(ocr_attempts,0) + 1
      WHERE id=$1
      `,
      [id]
    );

    await client.query("COMMIT");

    // ---------- 1) Download PDF from Spaces ----------
    const obj = await s3.send(
      new GetObjectCommand({
        Bucket: process.env.SPACES_BUCKET,
        Key: doc.spaces_key
      })
    );

    const chunks = [];
    for await (const chunk of obj.Body) chunks.push(chunk);
    const pdfBuffer = Buffer.concat(chunks);

    // ---------- 2) OCR (Textract only) ----------
    let providerUsed = null;
    let text = "";
    let ocrMeta = {};

    const tryTextract = forcedProvider ? forcedProvider === "TEXTRACT" : true;

    let textract = null;

    if (tryTextract) {
      providerUsed = "AWS_TEXTRACT";
      await pool.query(`UPDATE insurance_documents SET ocr_provider='AWS_TEXTRACT' WHERE id=$1`, [id]);

      textract = await ocrPdfBufferWithTextract({
        pdfBuffer,
        objectKeyHint: `${doc.dot_number}/${id}`
      });

      text = textract.fullText || "";

      if (!text || !text.trim()) {
        throw new Error("Textract OCR failed — produced empty text.");
      }

      ocrMeta = {
        jobId: textract.jobId,
        inputS3Uri: textract.inputS3Uri,
        avgLineConfidence: textract.confidence?.avgLineConfidence ?? null,
        lineCount: textract.confidence?.lineCount ?? null,
        tableCount: textract.tables?.length ?? 0,
        keyCount: textract.keyValuePairs?.pairs?.length ?? 0
      };
    }

// ---- normalize Textract confidence (0–100 → 0–1 for DB) ----
const avgPct = textract?.confidence?.avgLineConfidence;
const avg01 =
  typeof avgPct === "number"
    ? Math.max(0, Math.min(1, avgPct / 100))
    : null;

    
    // ---------- 3) Parse ----------
    const { parseResult, confidence, coverageTypes, autoLimit, cargoLimit, glLimit } =
      parseAcord25FromText(text, { ocrProvider: providerUsed, ocrMeta });

    // ---------- 4) Save ----------
    await pool.query(
      `
      UPDATE insurance_documents
      SET extracted_text = $1,
          ocr_provider = 'AWS_TEXTRACT',
          ocr_status = 'DONE',
          ocr_job_id = $2,
          ocr_avg_confidence = $3,
          ocr_input_uri = $4,
          ocr_output_uri = NULL,
          ocr_completed_at = NOW(),
          parse_result = $5::jsonb,
          parse_confidence = $6::numeric,
          parsed_at = NOW(),
          status = CASE WHEN $6::numeric >= 70 THEN status ELSE 'NEEDS_REVIEW' END
      WHERE id = $7
      `,
      [
        text,
        textract?.jobId || null,
        avg01,
        textract?.inputS3Uri || null,
        JSON.stringify(parseResult),
        confidence,
        id
      ]
    );

    // ---------- 5) Promote to snapshots ----------
    let newSnapshotVersion = null;

    if (confidence >= 70) {
      const upsert = await pool.query(
        `
        INSERT INTO insurance_snapshots
          (dot_number, auto_liability_limit, cargo_limit, general_liability_limit,
           source, vendor, last_checked_at, snapshot_version, raw_payload_json)
        VALUES
          ($1, $2, $3, $4,
           'PARSED', 'INTERNAL', NOW(), 1, $5)
        ON CONFLICT (dot_number)
        DO UPDATE SET
          auto_liability_limit = EXCLUDED.auto_liability_limit,
          cargo_limit = EXCLUDED.cargo_limit,
          general_liability_limit = EXCLUDED.general_liability_limit,
          source = EXCLUDED.source,
          vendor = EXCLUDED.vendor,
          last_checked_at = NOW(),
          snapshot_version = insurance_snapshots.snapshot_version + 1,
          raw_payload_json = EXCLUDED.raw_payload_json
        RETURNING snapshot_version
        `,
        [doc.dot_number, autoLimit, cargoLimit, glLimit, parseResult]
      );

      newSnapshotVersion = upsert.rows[0]?.snapshot_version ?? 1;

      await pool.query(
        `DELETE FROM insurance_coverages WHERE dot_number = $1 AND snapshot_version = $2`,
        [doc.dot_number, newSnapshotVersion]
      );

      for (const ct of coverageTypes) {
        let limits = {};
        if (ct === "AUTO" && autoLimit) limits = { combined_single_limit: autoLimit };
        if (ct === "CARGO" && cargoLimit) limits = { cargo: cargoLimit };
        if (ct === "GL" && glLimit) limits = { each_occurrence: glLimit };

        await pool.query(
          `
          INSERT INTO insurance_coverages
            (dot_number, snapshot_version, coverage_type, limits_json)
          VALUES
            ($1, $2, $3, $4)
          `,
          [doc.dot_number, newSnapshotVersion, ct, limits]
        );
      }
    }

    return res.json({
      ok: true,
      document_id: id,
      dot_number: doc.dot_number,
      ocr_provider: providerUsed,
      parseResult,
      promoted_to_snapshot: confidence >= 70,
      snapshot_version: newSnapshotVersion
    });
  } catch (err) {
    try {
      await pool.query(
        `
        UPDATE insurance_documents
        SET ocr_status = 'FAILED',
            ocr_error = $2,
            ocr_completed_at = NOW()
        WHERE id = $1
        `,
        [req.params.id, String(err?.message || err)]
      );
    } catch {}

    try { await client.query("ROLLBACK"); } catch {}

    return res.status(400).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});


module.exports = router;
