"use strict";

const express = require("express");
const { pool } = require("../../db/pool");
const { spaces } = require("../../clients/spacesS3v2");

const router = express.Router();

// GET /api/carriers/:dot/insurance-documents/:documentId/pdf
router.get("/carriers/:dot/insurance-documents/:documentId/pdf", async (req, res) => {
  const dot = String(req.params.dot || "").replace(/\D/g, "");
  const documentId = String(req.params.documentId || "").trim();
  if (!dot) return res.status(400).send("Missing DOT");
  if (!documentId) return res.status(400).send("Missing document id");

  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        dot_number,
        spaces_key,
        file_type,
        document_type,
        uploaded_at
      FROM public.insurance_documents
      WHERE id = $1
        AND dot_number = $2
      LIMIT 1;
      `,
      [documentId, dot]
    );

    if (!rows.length) return res.status(404).send("Not found");

    const doc = rows[0];
    if (!doc.spaces_key) return res.status(500).send("Missing storage key");

    const Bucket = process.env.SPACES_BUCKET;
    const Key = doc.spaces_key;

    const obj = spaces.getObject({ Bucket, Key }).createReadStream();

    obj.on("error", (err) => {
      console.error("SPACES getObject error:", err?.code, err?.message, err);
      if (err?.code === "NoSuchKey") return res.status(404).send("PDF not found");
      return res.status(500).send("Failed to load PDF");
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="coi_${dot}.pdf"`);
    res.setHeader("Cache-Control", "private, max-age=300");

    obj.pipe(res);
  } catch (err) {
    console.error("GET insurance doc pdf error:", err?.message, err);
    return res.status(500).send("Server error");
  }
});

module.exports = router;
