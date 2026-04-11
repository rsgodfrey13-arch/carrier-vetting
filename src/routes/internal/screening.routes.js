"use strict";

const express = require("express");
const { pool: globalPool } = require("../../db/pool");
const { requireAuth } = require("../../middleware/requireAuth");
const { loadCompanyContext, requireCompanyAdmin } = require("../../middleware/companyContext");


function normalizeEnumOptions(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x)).filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x)).filter(Boolean);
    } catch {
      return raw
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function parseBool(value) {
  if (value === true || value === false) return value;
  return null;
}

function parseNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function normalizeDateOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function screeningRoutes({ pool } = {}) {
  const db = pool || globalPool;
  const router = express.Router();

router.get("/screening/profiles", requireAuth, loadCompanyContext, async (req, res) => {
  try {
    const { companyId } = req.companyContext;
    const { rows } = await db.query(
      `
      SELECT id, profile_name, is_default, is_active, created_at, updated_at
      FROM public.company_screening_profiles
      WHERE company_id = $1
      ORDER BY is_default DESC, created_at ASC
      `,
      [companyId]
    );

    return res.json({ profiles: rows });
  } catch (err) {
    console.error("GET /api/screening/profiles failed:", err);
    return res.status(500).json({ error: "Failed to load screening profiles" });
  }
});

router.post("/screening/profiles", requireAuth, loadCompanyContext, requireCompanyAdmin, async (req, res) => {
  try {
    const { companyId } = req.companyContext;
    const profileName = String(req.body?.profile_name || "").trim();
    if (!profileName) {
      return res.status(400).json({ error: "profile_name is required" });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const countRes = await client.query(
        `SELECT COUNT(*)::int AS count FROM public.company_screening_profiles WHERE company_id = $1`,
        [companyId]
      );
      const isDefault = Number(countRes.rows[0]?.count || 0) === 0;

      const insertRes = await client.query(
        `
        INSERT INTO public.company_screening_profiles (company_id, profile_name, is_default, is_active)
        VALUES ($1, $2, $3, true)
        RETURNING id, profile_name, is_default, is_active, created_at, updated_at
        `,
        [companyId, profileName, isDefault]
      );

      await client.query("COMMIT");
      return res.json({ ok: true, profile: insertRes.rows[0] });
    } catch (innerErr) {
      await client.query("ROLLBACK");
      throw innerErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("POST /api/screening/profiles failed:", err);
    return res.status(500).json({ error: "Failed to create screening profile" });
  }
});

router.patch("/screening/profiles/:profileId", requireAuth, loadCompanyContext, requireCompanyAdmin, async (req, res) => {
  try {
    const { companyId } = req.companyContext;
    const { profileId } = req.params;

    const updates = [];
    const values = [companyId, profileId];

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "profile_name")) {
      const profileName = String(req.body.profile_name || "").trim();
      if (!profileName) {
        return res.status(400).json({ error: "profile_name cannot be empty" });
      }
      values.push(profileName);
      updates.push(`profile_name = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "is_active")) {
      const isActive = parseBool(req.body.is_active);
      if (isActive === null) {
        return res.status(400).json({ error: "is_active must be a boolean" });
      }
      values.push(isActive);
      updates.push(`is_active = $${values.length}`);
    }

    if (!updates.length) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    values.push(new Date().toISOString());
    updates.push(`updated_at = $${values.length}`);

    const { rows } = await db.query(
      `
      UPDATE public.company_screening_profiles
      SET ${updates.join(", ")}
      WHERE company_id = $1
        AND id = $2
      RETURNING id, profile_name, is_default, is_active, created_at, updated_at
      `,
      values
    );

    if (!rows.length) return res.status(404).json({ error: "Profile not found" });
    return res.json({ ok: true, profile: rows[0] });
  } catch (err) {
    console.error("PATCH /api/screening/profiles/:profileId failed:", err);
    return res.status(500).json({ error: "Failed to update screening profile" });
  }
});

router.post("/screening/profiles/:profileId/set-default", requireAuth, loadCompanyContext, requireCompanyAdmin, async (req, res) => {
  const client = await db.connect();
  try {
    const { companyId } = req.companyContext;
    const { profileId } = req.params;

    await client.query("BEGIN");

    const check = await client.query(
      `
      SELECT id
      FROM public.company_screening_profiles
      WHERE company_id = $1
        AND id = $2
      LIMIT 1
      `,
      [companyId, profileId]
    );

    if (!check.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Profile not found" });
    }

    await client.query(
      `
      UPDATE public.company_screening_profiles
      SET is_default = false,
          updated_at = now()
      WHERE company_id = $1
      `,
      [companyId]
    );

    await client.query(
      `
      UPDATE public.company_screening_profiles
      SET is_default = true,
          is_active = true,
          updated_at = now()
      WHERE company_id = $1
        AND id = $2
      `,
      [companyId, profileId]
    );

    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/screening/profiles/:profileId/set-default failed:", err);
    return res.status(500).json({ error: "Failed to set default screening profile" });
  } finally {
    client.release();
  }
});

router.delete("/screening/profiles/:profileId", requireAuth, loadCompanyContext, requireCompanyAdmin, async (req, res) => {
  try {
    const { companyId } = req.companyContext;
    const { profileId } = req.params;

    const profileRes = await db.query(
      `
      SELECT id, is_default
      FROM public.company_screening_profiles
      WHERE company_id = $1
        AND id = $2
      LIMIT 1
      `,
      [companyId, profileId]
    );

    const profile = profileRes.rows[0];
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    if (profile.is_default) {
      return res.status(409).json({ error: "Default profile cannot be deleted" });
    }

    await db.query(
      `
      DELETE FROM public.company_screening_profiles
      WHERE company_id = $1
        AND id = $2
      `,
      [companyId, profileId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/screening/profiles/:profileId failed:", err);
    return res.status(500).json({ error: "Failed to delete screening profile" });
  }
});

router.get("/screening/profiles/:profileId/criteria", requireAuth, loadCompanyContext, async (req, res) => {
  try {
    const { companyId } = req.companyContext;
    const { profileId } = req.params;

    const profileRes = await db.query(
      `
      SELECT id, profile_name, is_default, is_active
      FROM public.company_screening_profiles
      WHERE company_id = $1
        AND id = $2
      LIMIT 1
      `,
      [companyId, profileId]
    );

    if (!profileRes.rows.length) return res.status(404).json({ error: "Profile not found" });

    const criteriaRes = await db.query(
      `
      SELECT
        sc.id AS screening_criteria_id,
        sc.criteria_key,
        sc.label,
        sc.description,
        sc.value_type,
        sc.carrier_field,
        sc.category,
        sc.display_order,
        sc.enum_options,
        COALESCE(cspc.is_enabled, false) AS is_enabled,
        cspc.value_bool,
        cspc.value_number,
        cspc.value_date,
        cspc.value_text
      FROM public.screening_criteria sc
      LEFT JOIN public.company_screening_profile_criteria cspc
        ON cspc.profile_id = $1
       AND cspc.screening_criteria_id = sc.id
      WHERE sc.is_active = true
      ORDER BY sc.display_order ASC, sc.id ASC
      `,
      [profileId]
    );

    const criteria = criteriaRes.rows.map((row) => ({
      ...row,
      enum_options: normalizeEnumOptions(row.enum_options),
    }));

    return res.json({
      profile: profileRes.rows[0],
      criteria,
    });
  } catch (err) {
    console.error("GET /api/screening/profiles/:profileId/criteria failed:", err);
    return res.status(500).json({ error: "Failed to load screening criteria" });
  }
});

router.post("/screening/profiles/:profileId/criteria", requireAuth, loadCompanyContext, requireCompanyAdmin, async (req, res) => {
  const client = await db.connect();
  try {
    const { companyId } = req.companyContext;
    const { profileId } = req.params;
    const payload = Array.isArray(req.body?.criteria) ? req.body.criteria : null;

    if (!payload) {
      return res.status(400).json({ error: "criteria array is required" });
    }

    const profileRes = await client.query(
      `
      SELECT id
      FROM public.company_screening_profiles
      WHERE company_id = $1
        AND id = $2
      LIMIT 1
      `,
      [companyId, profileId]
    );
    if (!profileRes.rows.length) return res.status(404).json({ error: "Profile not found" });

    const criteriaDefs = await client.query(
      `
      SELECT id, value_type, enum_options
      FROM public.screening_criteria
      WHERE is_active = true
      `
    );

    const defsById = new Map(criteriaDefs.rows.map((r) => [String(r.id), r]));

    await client.query("BEGIN");

    for (const item of payload) {
      const criteriaId = String(item?.screening_criteria_id || "").trim();
      const def = defsById.get(criteriaId);
      if (!def) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `Unknown screening_criteria_id: ${criteriaId || "missing"}` });
      }

      const valueType = String(def.value_type || "").toUpperCase();
      const isEnabled = parseBool(item?.is_enabled) || false;
      let valueBool = null;
      let valueNumber = null;
      let valueDate = null;
      let valueText = null;

      if (valueType === "BOOLEAN") {
        if (item?.value_bool !== null && item?.value_bool !== undefined) {
          const parsed = parseBool(item.value_bool);
          if (parsed === null) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: `Invalid BOOLEAN value for criteria ${criteriaId}` });
          }
          valueBool = parsed;
        }
      } else if (valueType === "NUMBER") {
        if (item?.value_number !== null && item?.value_number !== undefined && item?.value_number !== "") {
          const parsed = parseNumberOrNull(item.value_number);
          if (parsed === null) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: `Invalid NUMBER value for criteria ${criteriaId}` });
          }
          valueNumber = parsed;
        }
      } else if (valueType === "DATE") {
        if (item?.value_date !== null && item?.value_date !== undefined && item?.value_date !== "") {
          const parsed = normalizeDateOrNull(item.value_date);
          if (!parsed) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: `Invalid DATE value for criteria ${criteriaId}` });
          }
          valueDate = parsed;
        }
      } else if (valueType === "ENUM") {
        if (item?.value_text !== null && item?.value_text !== undefined && item?.value_text !== "") {
          const nextValue = String(item.value_text).trim();
          const options = normalizeEnumOptions(def.enum_options);
          if (options.length && !options.includes(nextValue)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: `Invalid ENUM value for criteria ${criteriaId}` });
          }
          valueText = nextValue;
        }
      }

      await client.query(
        `
        INSERT INTO public.company_screening_profile_criteria (
          profile_id,
          screening_criteria_id,
          is_enabled,
          value_bool,
          value_number,
          value_date,
          value_text,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, now())
        ON CONFLICT (profile_id, screening_criteria_id)
        DO UPDATE SET
          is_enabled = EXCLUDED.is_enabled,
          value_bool = EXCLUDED.value_bool,
          value_number = EXCLUDED.value_number,
          value_date = EXCLUDED.value_date,
          value_text = EXCLUDED.value_text,
          updated_at = now()
        `,
        [profileId, criteriaId, isEnabled, valueBool, valueNumber, valueDate, valueText]
      );
    }

    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/screening/profiles/:profileId/criteria failed:", err);
    return res.status(500).json({ error: "Failed to save screening criteria" });
  } finally {
    client.release();
  }
});

router.get("/screening/carriers/:dot/default-result", requireAuth, loadCompanyContext, async (req, res) => {
  try {
    const { companyId } = req.companyContext;
    const dot = String(req.params.dot || "").replace(/\D/g, "");
    if (!dot) return res.status(400).json({ error: "Valid DOT is required" });

    const profileRes = await db.query(
      `
      SELECT id, profile_name
      FROM public.company_screening_profiles
      WHERE company_id = $1
        AND is_default = true
      LIMIT 1
      `,
      [companyId]
    );

    const profile = profileRes.rows[0] || null;
    if (!profile) {
      return res.json({
        has_default_profile: false,
        profile: null,
        result: null,
      });
    }

    const resultRes = await db.query(
      `
      SELECT
        screening_status,
        matched_count,
        failed_count,
        review_count,
        result_summary,
        evaluated_at
      FROM public.company_carrier_screening_results
      WHERE company_id = $1
        AND profile_id = $2
        AND carrier_dot = $3
      ORDER BY evaluated_at DESC NULLS LAST, updated_at DESC NULLS LAST
      LIMIT 1
      `,
      [companyId, profile.id, dot]
    );

    return res.json({
      has_default_profile: true,
      profile,
      result: resultRes.rows[0] || null,
    });
  } catch (err) {
    console.error("GET /api/screening/carriers/:dot/default-result failed:", err);
    return res.status(500).json({ error: "Failed to load screening result" });
  }
});

  return router;
}

module.exports = screeningRoutes;
