"use strict";

const express = require("express");
const { pool } = require("../../db/pool");

const router = express.Router();

// GET /api/carriers/:dot/insurance-coverages
router.get("/carriers/:dot/insurance-coverages", async (req, res) => {
  const dot = String(req.params.dot || "").replace(/\D/g, "");
  if (!dot) return res.status(400).json({ error: "Missing DOT" });

const sql = `
  WITH cov AS (
    SELECT
      c.id,
      c.coverage_type,
      c.coverage_type_raw,
      c.insurer_name,
      c.policy_number,
      c.insurer_letter,
      c.additional_insured,
      c.subrogation_waived,
      c.effective_date,
      c.expiration_date,
      c.created_at,
      c.document_id
    FROM public.insurance_coverages c
    WHERE c.dot_number = $1
  )
  SELECT
    c.*,
    COALESCE(lim.limits, '[]'::jsonb) AS limits
  FROM cov c
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'label', l."label",
        'currency', l.currency,
        'amount', l.amount,
        'amount_primary', l.amount_primary,
        'amount_secondary', l.amount_secondary,
        'amount_text', l.amount_text,
        'value_text', l.value_text,
        'sort_order', l.sort_order
      )
      ORDER BY
        (l.sort_order IS NULL) ASC,
        l.sort_order ASC,
        l."label" ASC
    ) AS limits
    FROM public.insurance_coverage_limits l
    WHERE l.coverage_id = c.id
  ) lim ON true
  ORDER BY
    c.expiration_date DESC NULLS LAST,
    c.coverage_type ASC,
    c.created_at DESC;
`;


  try {
    const { rows } = await pool.query(sql, [dot]);
    return res.json({ rows });
  } catch (e) {
    console.error("carrier insurance coverages error", e);
    return res.status(500).json({ error: "Failed to load insurance coverages" });
  }
});

module.exports = router;
