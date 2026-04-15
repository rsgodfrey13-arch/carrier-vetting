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

// ✅ add these (adjust paths if your middleware lives elsewhere)
const { requireAuth } = require("../../middleware/requireAuth");
const {
  loadCompanyContext,
  requireCompanyAdmin,
} = require("../../middleware/companyContext");

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

// ✅ FIX: do NOT map BROKER -> CUSTOMER
function normalizeUploadedBy(v) {
  const x = String(v || "").toUpperCase().trim();
  if (x === "BROKER") return "BROKER";
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

function normalizeCoverageType(v) {
  const x = String(v || "").toUpperCase().trim();
  const allowed = new Set([
    "AUTO_LIABILITY",
    "CARGO",
    "GENERAL_LIABILITY",
    "UMBRELLA_LIABILITY",
    "WORKERS_COMP",
    "ERRORS_OMISSIONS",
    "CONTINGENT_AUTO_LIABILITY",
  ]);
  if (!allowed.has(x)) {
    throw new Error("Invalid coverage_type.");
  }
  return x;
}

function normalizeDocumentReviewAction(v) {
  const x = String(v || "").toUpperCase().trim();
  if (x === "SAVE_COVERAGE" || x === "CLOSE") return x;
  throw new Error("action must be SAVE_COVERAGE or CLOSE.");
}

function normalizeCoverageCurrency(v) {
  const x = String(v || "USD").toUpperCase().trim();
  if (x === "USD") return "USD";
  throw new Error("currency must be USD.");
}

function blankToNull(v) {
  const x = String(v ?? "").trim();
  return x ? x : null;
}

function toDocumentBasedOcrError(message, documentId) {
  const raw = String(message || "").trim();
  if (!raw) return raw;

  if (!raw.toLowerCase().includes("insurance_ocr_jobs")) {
    return raw;
  }

  const docIdMatch = raw.match(/docupipe_document_id\s*=\s*([^\s,;]+)/i);
  const id = documentId || docIdMatch?.[1] || "unknown";
  return `No OCR job row found for document_id=${id}.`;
}

async function dbFunctionExists(client, schema, fnName) {
  const { rows } = await client.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = $1
        AND p.proname = $2
    ) AS exists;
    `,
    [schema, fnName]
  );
  return rows?.[0]?.exists === true;
}

async function getFunctionArgCounts(client, schema, fnName) {
  const { rows } = await client.query(
    `
    SELECT p.pronargs::int AS arg_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = $1
      AND p.proname = $2;
    `,
    [schema, fnName]
  );
  return rows.map((r) => r.arg_count);
}

function hasArgCount(argCounts, count) {
  return Array.isArray(argCounts) && argCounts.includes(count);
}

function getCoverageIdFromFunctionRow(row) {
  if (!row || typeof row !== "object") return null;
  return row.coverage_id || row.id || row.inserted_coverage_id || row.out_coverage_id || null;
}

async function closeDocumentReviewException(client, exceptionId, closeNotes) {
  const hasCloseFunction = await dbFunctionExists(client, "public", "close_insurance_document_review_exception");
  if (hasCloseFunction) {
    const argCounts = await getFunctionArgCounts(client, "public", "close_insurance_document_review_exception");

    if (hasArgCount(argCounts, 3)) {
      const { rows } = await client.query(
        "SELECT * FROM public.close_insurance_document_review_exception($1, $2, $3);",
        [exceptionId, "RESOLVED", closeNotes]
      );
      return { mode: "function", result: rows?.[0] ?? null, arg_count_used: 3 };
    }

    if (hasArgCount(argCounts, 2)) {
      const { rows } = await client.query(
        "SELECT * FROM public.close_insurance_document_review_exception($1, $2);",
        [exceptionId, closeNotes]
      );
      return { mode: "function", result: rows?.[0] ?? null, arg_count_used: 2 };
    }

    throw new Error(
      `Unsupported signature for close_insurance_document_review_exception. Found arg counts: ${argCounts.join(", ") || "none"}.`
    );
  }

  const updated = await client.query(
    `
    UPDATE public.insurance_document_review_exceptions
    SET status = 'RESOLVED',
        resolution_notes = $2,
        resolved_at = NOW()
    WHERE id = $1
      AND status = 'OPEN'
    RETURNING id;
    `,
    [exceptionId, closeNotes]
  );

  return { mode: "update", updatedCount: updated.rowCount };
}

async function closeNormalizationException(client, exceptionId, closeNotes) {
  const hasCloseFunction = await dbFunctionExists(client, "public", "close_insurance_exception_manual");
  if (hasCloseFunction) {
    const argCounts = await getFunctionArgCounts(client, "public", "close_insurance_exception_manual");

    if (hasArgCount(argCounts, 3)) {
      const { rows } = await client.query(
        "SELECT * FROM public.close_insurance_exception_manual($1, $2, $3);",
        [exceptionId, "RESOLVED", closeNotes]
      );
      return { mode: "function", result: rows?.[0] ?? null, arg_count_used: 3 };
    }

    if (hasArgCount(argCounts, 2)) {
      const { rows } = await client.query(
        "SELECT * FROM public.close_insurance_exception_manual($1, $2);",
        [exceptionId, closeNotes]
      );
      return { mode: "function", result: rows?.[0] ?? null, arg_count_used: 2 };
    }

    throw new Error(
      `Unsupported signature for close_insurance_exception_manual. Found arg counts: ${argCounts.join(", ") || "none"}.`
    );
  }

  const updated = await client.query(
    `
    UPDATE public.insurance_normalization_exceptions
    SET status = 'RESOLVED',
        resolution_notes = $2,
        resolved_at = NOW()
    WHERE id = $1
      AND status = 'OPEN'
    RETURNING id;
    `,
    [exceptionId, closeNotes]
  );

  return { mode: "update", updatedCount: updated.rowCount };
}

/**
 * GET /api/admin/insurance/document-review-exceptions
 */
router.get(
  "/admin/insurance/document-review-exceptions",
  requireAuth,
  loadCompanyContext,
  requireCompanyAdmin,
  async (req, res) => {
    try {
      const companyId = req.companyContext?.companyId || req.company_id || req.companyId;
      if (!companyId) throw new Error("Missing company context.");

      const { rows } = await pool.query(
        `
        SELECT
          e.id AS exception_id,
          e.document_id,
          e.dot_number,
          e.exception_type,
          e.exception_reason,
          d.uploaded_at,
          COALESCE(c.legalname, c.dbaname) AS carrier_name
        FROM public.insurance_document_review_exceptions e
        JOIN public.insurance_documents d
          ON d.id = e.document_id
        LEFT JOIN public.carriers c
          ON c.dotnumber = e.dot_number
        WHERE e.status = 'OPEN'
          AND d.company_id = $1
        ORDER BY e.created_at ASC;
        `,
        [companyId]
      );

      return res.json({ ok: true, rows });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message || "Failed to load document review queue." });
    }
  }
);

/**
 * POST /api/admin/insurance/document-review-exceptions/:exceptionId/resolve
 */
router.post(
  "/admin/insurance/document-review-exceptions/:exceptionId/resolve",
  requireAuth,
  loadCompanyContext,
  requireCompanyAdmin,
  async (req, res) => {
    const client = await pool.connect();
    let resolveDocumentId = null;

    try {
      const companyId = req.companyContext?.companyId || req.company_id || req.companyId;
      const exceptionId = String(req.params.exceptionId || "").trim();
      const action = normalizeDocumentReviewAction(req.body?.action);
      const closeNotes = String(req.body?.resolution_notes || "").trim() || "Closed manually";

      if (!companyId) throw new Error("Missing company context.");
      if (!exceptionId) throw new Error("exceptionId is required.");

      await client.query("BEGIN");

      const exceptionDoc = await client.query(
        `
        SELECT e.id, e.document_id
        FROM public.insurance_document_review_exceptions e
        JOIN public.insurance_documents d
          ON d.id = e.document_id
        WHERE e.id = $1
          AND d.company_id = $2
        LIMIT 1;
        `,
        [exceptionId, companyId]
      );

      if (!exceptionDoc.rowCount) {
        throw new Error("Document review exception not found for this company.");
      }
      resolveDocumentId = exceptionDoc.rows[0].document_id;

      if (action === "CLOSE") {
        const closeResult = await closeDocumentReviewException(client, exceptionId, closeNotes);
        await client.query("COMMIT");
        return res.json({ ok: true, action: "CLOSE", close_result: closeResult });
      }

      const coverageType = String(req.body?.coverage_type || "").trim();
      const coverageTypeRaw = blankToNull(req.body?.coverage_type_raw) || coverageType;
      const insurerLetter = blankToNull(req.body?.insurer_letter);
      const insurerName = String(req.body?.insurer_name || "").trim();
      const policyNumber = blankToNull(req.body?.policy_number);
      const effectiveDate = String(req.body?.effective_date || "").trim();
      const expirationDate = String(req.body?.expiration_date || "").trim();
      const limitLabel = blankToNull(req.body?.limit_label) || "Amount";
      const currency = normalizeCoverageCurrency(req.body?.currency);
      const amount = Number(req.body?.amount);

      if (!coverageType) throw new Error("coverage_type is required.");
      if (!insurerName) throw new Error("insurer_name is required.");
      if (!effectiveDate) throw new Error("effective_date is required.");
      if (!expirationDate) throw new Error("expiration_date is required.");
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount must be a positive number.");

      const generatedCoverageId = crypto.randomUUID();
      const coverageArgCounts = await getFunctionArgCounts(client, "public", "manual_insert_insurance_coverage");
      const coverageLimitArgCounts = await getFunctionArgCounts(client, "public", "manual_insert_insurance_coverage_limit");
      let coverageIdForLimit = generatedCoverageId;

      if (hasArgCount(coverageArgCounts, 11)) {
        await client.query(
          `
          SELECT *
          FROM public.manual_insert_insurance_coverage($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
          `,
          [
            exceptionDoc.rows[0].document_id,
            generatedCoverageId,
            coverageType,
            coverageTypeRaw,
            insurerLetter,
            insurerName,
            policyNumber,
            effectiveDate,
            expirationDate,
            null,
            null,
          ]
        );
      } else if (hasArgCount(coverageArgCounts, 7)) {
        const sevenArgInsert = await client.query(
          `
          SELECT *
          FROM public.manual_insert_insurance_coverage($1, $2, $3, $4, $5, $6, $7);
          `,
          [
            exceptionDoc.rows[0].document_id,
            coverageType,
            coverageTypeRaw,
            insurerLetter,
            insurerName,
            policyNumber,
            effectiveDate,
          ]
        );

        const insertedCoverageId = getCoverageIdFromFunctionRow(sevenArgInsert.rows?.[0]);
        if (!insertedCoverageId) {
          throw new Error(
            "manual_insert_insurance_coverage(7 args) did not return a usable coverage id, so the limit insert was not attempted."
          );
        }
        coverageIdForLimit = insertedCoverageId;
      } else {
        throw new Error(
          `Unsupported signature for manual_insert_insurance_coverage. Found arg counts: ${coverageArgCounts.join(", ") || "none"}.`
        );
      }

      if (hasArgCount(coverageLimitArgCounts, 9)) {
        await client.query(
          `
          SELECT *
          FROM public.manual_insert_insurance_coverage_limit($1, $2, $3, $4, $5, $6, $7, $8, $9);
          `,
          [coverageIdForLimit, limitLabel, currency, amount, null, null, null, null, 1]
        );
      } else if (hasArgCount(coverageLimitArgCounts, 4)) {
        await client.query(
          `
          SELECT *
          FROM public.manual_insert_insurance_coverage_limit($1, $2, $3, $4);
          `,
          [coverageIdForLimit, limitLabel, currency, amount]
        );
      } else {
        throw new Error(
          `Unsupported signature for manual_insert_insurance_coverage_limit. Found arg counts: ${coverageLimitArgCounts.join(", ") || "none"}.`
        );
      }

      // Document-review SAVE_COVERAGE flow is intentionally raw-insert-only:
      // 1) insert raw coverage, 2) insert raw limit, 3) close document-review exception.
      // Normalization is NOT auto-run in this transaction.
      const closeResult = await closeDocumentReviewException(client, exceptionId, "Resolved after manual coverage insert");

      await client.query("COMMIT");
      return res.json({
        ok: true,
        action: "SAVE_COVERAGE",
        coverage_id: coverageIdForLimit,
        close_result: closeResult,
      });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      const surfacedError = toDocumentBasedOcrError(err?.message, resolveDocumentId);
      return res.status(400).json({ ok: false, error: surfacedError || "Resolve failed." });
    } finally {
      client.release();
    }
  }
);


/**
 * GET /api/admin/insurance/normalization-exceptions
 */
router.get(
  "/admin/insurance/normalization-exceptions",
  requireAuth,
  loadCompanyContext,
  requireCompanyAdmin,
  async (req, res) => {
    try {
      const companyId = req.companyContext?.companyId || req.company_id || req.companyId;
      if (!companyId) throw new Error("Missing company context.");

      const { rows } = await pool.query(
        `
        SELECT
          e.id AS exception_id,
          e.document_id,
          e.dot_number,
          e.exception_type,
          e.exception_reason,
          e.source_coverage_type,
          e.source_coverage_type_raw,
          d.uploaded_at,
          COALESCE(c.legalname, c.dbaname) AS carrier_name
        FROM public.insurance_normalization_exceptions e
        JOIN public.insurance_documents d
          ON d.id = e.document_id
        LEFT JOIN public.carriers c
          ON c.dotnumber = e.dot_number
        WHERE e.status = 'OPEN'
          AND d.company_id = $1
        ORDER BY e.created_at ASC;
        `,
        [companyId]
      );

      return res.json({ ok: true, rows });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message || "Failed to load queue." });
    }
  }
);

/**
 * POST /api/admin/insurance/normalization-exceptions/:exceptionId/resolve
 */
router.post(
  "/admin/insurance/normalization-exceptions/:exceptionId/resolve",
  requireAuth,
  loadCompanyContext,
  requireCompanyAdmin,
  async (req, res) => {
    const client = await pool.connect();

    try {
      const companyId = req.companyContext?.companyId || req.company_id || req.companyId;
      const exceptionId = String(req.params.exceptionId || "").trim();
      const action = String(req.body?.action || "").toUpperCase().trim();
      const resolutionNotes = String(req.body?.resolution_notes || "").trim() || "Closed manually";

      if (!companyId) throw new Error("Missing company context.");
      if (!exceptionId) throw new Error("exceptionId is required.");
      if (action !== "SAVE_COVERAGE" && action !== "CLOSE") {
        throw new Error("action must be SAVE_COVERAGE or CLOSE.");
      }

      await client.query("BEGIN");

      const exceptionDoc = await client.query(
        `
        SELECT e.id, e.document_id
        FROM public.insurance_normalization_exceptions e
        JOIN public.insurance_documents d
          ON d.id = e.document_id
        WHERE e.id = $1
          AND d.company_id = $2
        LIMIT 1;
        `,
        [exceptionId, companyId]
      );

      if (!exceptionDoc.rowCount) throw new Error("Normalization exception not found for this company.");

      if (action === "CLOSE") {
        const closeResult = await closeNormalizationException(client, exceptionId, resolutionNotes);
        await client.query("COMMIT");
        return res.json({
          ok: true,
          action: "CLOSE",
          close_result: closeResult,
        });
      }

      const normalizedCoverageType = normalizeCoverageType(req.body?.normalized_coverage_type);
      const selectedLimitAmount = Number(req.body?.selected_limit_amount);

      if (!Number.isFinite(selectedLimitAmount) || selectedLimitAmount <= 0) {
        throw new Error("selected_limit_amount must be a positive number.");
      }

      const fnResult = await client.query(
        `
        SELECT *
        FROM public.resolve_insurance_exception_manual($1, $2, $3);
        `,
        [exceptionId, normalizedCoverageType, selectedLimitAmount]
      );

      await client.query("COMMIT");

      return res.json({
        ok: true,
        action: "SAVE_COVERAGE",
        result: fnResult.rows?.[0] ?? null,
      });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      return res.status(400).json({ ok: false, error: err.message || "Resolve failed." });
    } finally {
      client.release();
    }
  }
);

/**
 * GET /api/insurance/latest?dot=123
 */
router.get("/insurance/latest", requireAuth, loadCompanyContext, async (req, res) => {
  try {
    const companyId = req.companyContext?.companyId || req.company_id || req.companyId;
    if (!companyId) throw new Error("Missing company context.");

    const dot = String(req.query.dot || "").replace(/\D/g, "");
    if (!dot) throw new Error("dot query param is required (numbers only).");

    const r = await pool.query(
      `
      SELECT id, company_id, dot_number, uploaded_by, document_type, status, uploaded_at, spaces_key
      FROM insurance_documents
      WHERE company_id = $1 AND dot_number = $2
      ORDER BY uploaded_at DESC
      LIMIT 1
      `,
      [companyId, dot]
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
      ResponseContentDisposition: `inline; filename="COI-${doc.dot_number}.pdf"`,
    });

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 60 * 10 });

    return res.json({
      ok: true,
      dot_number: dot,
      document: doc,
      signedUrl,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/insurance/documents
 * (multipart form-data: document=pdf, dot_number, uploaded_by, document_type)
 */
router.post(
  "/insurance/documents",
  requireAuth,
  loadCompanyContext,
  upload.single("document"),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const companyId = req.companyContext?.companyId || req.company_id || req.companyId;
      if (!companyId) throw new Error("Missing company context.");

      if (!req.file) throw new Error("document (PDF) is required.");

      const dot_number = normalizeDot(req.body.dot_number);
      const uploaded_by = normalizeUploadedBy(req.body.uploaded_by);
      const document_type = normalizeDocType(req.body.document_type);

      const rand = crypto.randomBytes(10).toString("hex");
      const key = `insurance/${companyId}/${dot_number}/${Date.now()}-${rand}.pdf`;

      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.SPACES_BUCKET,
          Key: key,
          Body: req.file.buffer,
          ContentType: "application/pdf",
          ACL: "private",
          Metadata: { dot_number, uploaded_by, document_type, company_id: String(companyId) },
        })
      );

      const file_url = `s3://${process.env.SPACES_BUCKET}/${key}`;

      await client.query("BEGIN");

      // ✅ add company_id to the record
      const result = await client.query(
        `
        INSERT INTO insurance_documents
          (company_id, dot_number, uploaded_by, file_url, spaces_key, file_type, document_type, status, ocr_status)
        VALUES
          ($1, $2, $3, $4, $5, 'PDF', $6, 'ON_FILE', 'PENDING')
        RETURNING id, company_id, dot_number, uploaded_by, file_url, spaces_key, file_type, document_type, status, uploaded_at, ocr_status
        `,
        [companyId, dot_number, uploaded_by, file_url, key, document_type]
      );

      const documentId = result.rows[0].id;

      await client.query(
        `
        INSERT INTO insurance_ocr_jobs (document_id, provider, status, attempt, dot_number)
        VALUES ($1, 'DOCUPIPE', 'PENDING', 0, $2)
        `,
        [documentId, dot_number]
      );

      await client.query("COMMIT");

      return res.status(201).json({ ok: true, document: result.rows[0] });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      return res.status(400).json({ ok: false, error: err.message || "Upload failed" });
    } finally {
      client.release();
    }
  }
);

/**
 * GET /api/insurance/documents?dot=123
 */
router.get("/insurance/documents", requireAuth, loadCompanyContext, async (req, res) => {
  try {
    const companyId = req.companyContext?.companyId || req.company_id || req.companyId;
    if (!companyId) throw new Error("Missing company context.");

    const dot = String(req.query.dot || "").replace(/\D/g, "");
    if (!dot) throw new Error("dot query param is required (numbers only).");

    const r = await pool.query(
      `
      SELECT id, company_id, dot_number, uploaded_by, document_type, status, uploaded_at,
             file_url, spaces_key
      FROM insurance_documents
      WHERE company_id = $1 AND dot_number = $2
      ORDER BY uploaded_at DESC
      LIMIT 50
      `,
      [companyId, dot]
    );

    res.json({ ok: true, documents: r.rows });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/insurance/documents/:id/signed-url
 */
router.get("/insurance/documents/:id/signed-url", requireAuth, loadCompanyContext, async (req, res) => {
  try {
    const companyId = req.companyContext?.companyId || req.company_id || req.companyId;
    if (!companyId) throw new Error("Missing company context.");

    const { id } = req.params;

    const r = await pool.query(
      `
      SELECT id, company_id, dot_number, spaces_key, file_url
      FROM insurance_documents
      WHERE id = $1 AND company_id = $2
      `,
      [id, companyId]
    );

    if (r.rowCount === 0) throw new Error("Document not found.");
    const doc = r.rows[0];
    if (!doc.spaces_key) throw new Error("spaces_key is missing for this document.");

    const command = new GetObjectCommand({
      Bucket: process.env.SPACES_BUCKET,
      Key: doc.spaces_key,
      ResponseContentType: "application/pdf",
    });

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 60 * 10 });

    res.json({ ok: true, id: doc.id, dot_number: doc.dot_number, signedUrl });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/insurance/documents/:id/parse
 * NOTE: this keeps your existing parse logic, but adds company scoping to prevent leakage.
 */
router.post("/insurance/documents/:id/parse", requireAuth, loadCompanyContext, async (req, res) => {
  const client = await pool.connect();

  const forcedProvider = "TEXTRACT"; // keeping your hard-force behavior

  try {
    const companyId = req.companyContext?.companyId || req.company_id || req.companyId;
    if (!companyId) throw new Error("Missing company context.");

    const { id } = req.params;

    // ---------- 0) Lock + idempotency ----------
    await client.query("BEGIN");

    const r = await client.query(
      `
      SELECT id, company_id, dot_number, spaces_key, ocr_status, ocr_provider, parse_result
      FROM insurance_documents
      WHERE id = $1 AND company_id = $2
      FOR UPDATE
      `,
      [id, companyId]
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
        reused: true,
      });
    }

    await client.query(
      `
      UPDATE insurance_documents
      SET ocr_status='PROCESSING',
          ocr_started_at=NOW(),
          ocr_attempts = COALESCE(ocr_attempts,0) + 1
      WHERE id=$1 AND company_id=$2
      `,
      [id, companyId]
    );

    await client.query("COMMIT");

    // ---------- 1) Download PDF from Spaces ----------
    const obj = await s3.send(
      new GetObjectCommand({
        Bucket: process.env.SPACES_BUCKET,
        Key: doc.spaces_key,
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
      await pool.query(`UPDATE insurance_documents SET ocr_provider='AWS_TEXTRACT' WHERE id=$1 AND company_id=$2`, [
        id,
        companyId,
      ]);

      textract = await ocrPdfBufferWithTextract({
        pdfBuffer,
        objectKeyHint: `${doc.dot_number}/${id}`,
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
        keyCount: textract.keyValuePairs?.pairs?.length ?? 0,
      };
    }

    // ---- normalize Textract confidence (0–100 → 0–1 for DB) ----
    const avgPct = textract?.confidence?.avgLineConfidence;
    const avg01 = typeof avgPct === "number" ? Math.max(0, Math.min(1, avgPct / 100)) : null;

    // ---------- 3) Parse ----------
    const { parseResult, confidence, coverageTypes, autoLimit, cargoLimit, glLimit } = parseAcord25FromText(text, {
      ocrProvider: providerUsed,
      ocrMeta,
    });

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
      WHERE id = $7 AND company_id = $8
      `,
      [text, textract?.jobId || null, avg01, textract?.inputS3Uri || null, JSON.stringify(parseResult), confidence, id, companyId]
    );

    // ---------- 5) Promote to snapshots (kept as-is) ----------
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

      await pool.query(`DELETE FROM insurance_coverages WHERE dot_number = $1 AND snapshot_version = $2`, [
        doc.dot_number,
        newSnapshotVersion,
      ]);

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
      snapshot_version: newSnapshotVersion,
    });
  } catch (err) {
    try {
      const companyId = req.companyContext?.companyId || req.company_id || req.companyId;
      await pool.query(
        `
        UPDATE insurance_documents
        SET ocr_status = 'FAILED',
            ocr_error = $2,
            ocr_completed_at = NOW()
        WHERE id = $1 AND company_id = $3
        `,
        [req.params.id, String(err?.message || err), companyId]
      );
    } catch {}

    try {
      await client.query("ROLLBACK");
    } catch {}

    return res.status(400).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
