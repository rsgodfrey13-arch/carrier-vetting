"use strict";

const express = require("express");
const crypto = require("crypto");
const { pool } = require("../../db/pool");

// adjust these imports to match your project
const requireAuth = require("../middleware/requireAuth");
const loadCompanyContext = require("../middleware/loadCompanyContext");

// You implement this in your mailgun helper.
// Expected signature:
// sendTeamInviteEmail({ to, inviter_name, company_name, invite_url, expires_hours })
const { sendTeamInviteEmail } = require("../../utils/mailgun"); // <-- adjust path

const router = express.Router();

const INVITE_EXPIRES_HOURS = 72;

function requireCompanyAdmin(req, res) {
  const role = req.companyContext?.role;
  if (role !== "OWNER" && role !== "ADMIN") {
    res.status(403).json({ error: "Insufficient permissions" });
    return false;
  }
  return true;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function makeToken() {
  // URL-safe token
  return crypto.randomBytes(24).toString("hex");
}

function baseUrl(req) {
  // Prefer explicit env in prod; fallback to request host
  return (
    process.env.APP_BASE_URL ||
    `${req.protocol}://${req.get("host")}`
  );
}

function inviteUrl(req, token) {
  return `${baseUrl(req)}/accept-invite/${token}`;
}

/**
 * GET /api/team
 * returns { members, invites }
 */
router.get("/team", requireAuth, loadCompanyContext, async (req, res) => {
  const companyId = req.companyContext?.companyId;
  if (!companyId) return res.status(400).json({ error: "No company context" });

  try {
    const membersQ = pool.query(
      `
      SELECT
        cm.id,
        cm.company_id,
        cm.user_id,
        cm.role,
        cm.status,
        cm.created_at,
        u.email,
        u.name
      FROM public.company_members cm
      JOIN public.users u
        ON u.id = cm.user_id
      WHERE cm.company_id = $1
      ORDER BY
        (cm.role = 'OWNER') DESC,
        (cm.role = 'ADMIN') DESC,
        cm.created_at ASC
      `,
      [companyId]
    );

    const invitesQ = pool.query(
      `
      SELECT
        id,
        company_id,
        invited_email,
        role,
        status,
        expires_at,
        created_at,
        accepted_at
      FROM public.company_invites
      WHERE company_id = $1
        AND status = 'PENDING'
      ORDER BY created_at DESC
      `,
      [companyId]
    );

    const [membersR, invitesR] = await Promise.all([membersQ, invitesQ]);

    return res.json({
      members: membersR.rows || [],
      invites: invitesR.rows || [],
    });
  } catch (err) {
    console.error("GET /api/team error:", err);
    return res.status(500).json({ error: "Failed to load team" });
  }
});

/**
 * POST /api/team/invites
 * body: { email, role }
 * creates invite token + sends email
 */
router.post("/team/invites", requireAuth, loadCompanyContext, async (req, res) => {
  const companyId = req.companyContext?.companyId;
  if (!companyId) return res.status(400).json({ error: "No company context" });
  if (!requireCompanyAdmin(req, res)) return;

  const invitedEmail = normalizeEmail(req.body?.email);
  const role = String(req.body?.role || "MEMBER").toUpperCase();

  if (!invitedEmail || !invitedEmail.includes("@")) {
    return res.status(400).json({ error: "Invalid email" });
  }
  if (role !== "ADMIN" && role !== "MEMBER") {
    return res.status(400).json({ error: "Invalid role" });
  }

  const token = makeToken();

  try {
    // Basic guard: don't invite someone already an ACTIVE member
    const exists = await pool.query(
      `
      SELECT 1
      FROM public.company_members cm
      JOIN public.users u ON u.id = cm.user_id
      WHERE cm.company_id = $1
        AND cm.status = 'ACTIVE'
        AND lower(u.email) = $2
      LIMIT 1
      `,
      [companyId, invitedEmail]
    );

    if (exists.rows.length) {
      return res.status(409).json({ error: "That user is already a teammate." });
    }

    const expiresAt = new Date(Date.now() + INVITE_EXPIRES_HOURS * 60 * 60 * 1000);

    // Pull inviter + company name for email
    const meta = await pool.query(
      `
      SELECT
        u.name AS inviter_name,
        u.email AS inviter_email,
        c.name AS company_name
      FROM public.users u
      JOIN public.companies c ON c.id = $1
      WHERE u.id = $2
      LIMIT 1
      `,
      [companyId, req.session.userId]
    );

    const inviterName = meta.rows?.[0]?.inviter_name || meta.rows?.[0]?.inviter_email || "A teammate";
    const companyName = meta.rows?.[0]?.company_name || "Carrier Shark";

    const ins = await pool.query(
      `
      INSERT INTO public.company_invites (
        company_id,
        invited_email,
        role,
        invited_by_user_id,
        token,
        status,
        expires_at
      )
      VALUES ($1, $2, $3, $4, $5, 'PENDING', $6)
      RETURNING id, token, invited_email, role, status, expires_at, created_at
      `,
      [companyId, invitedEmail, role, req.session.userId, token, expiresAt]
    );

    const url = inviteUrl(req, token);

    // Send email (Mailgun)
    await sendTeamInviteEmail({
      to: invitedEmail,
      inviter_name: inviterName,
      company_name: companyName,
      invite_url: url,
      expires_hours: INVITE_EXPIRES_HOURS,
    });

    return res.json({ ok: true, invite: ins.rows[0] });
  } catch (err) {
    console.error("POST /api/team/invites error:", err);
    return res.status(500).json({ error: "Failed to create invite" });
  }
});

/**
 * POST /api/team/invites/resend
 * body: { invite_id }
 */
router.post("/team/invites/resend", requireAuth, loadCompanyContext, async (req, res) => {
  const companyId = req.companyContext?.companyId;
  if (!companyId) return res.status(400).json({ error: "No company context" });
  if (!requireCompanyAdmin(req, res)) return;

  const inviteId = req.body?.invite_id;
  if (!inviteId) return res.status(400).json({ error: "Missing invite_id" });

  try {
    const { rows } = await pool.query(
      `
      SELECT
        i.id,
        i.company_id,
        i.invited_email,
        i.role,
        i.status,
        i.token,
        i.expires_at,
        c.name AS company_name,
        u.name AS inviter_name,
        u.email AS inviter_email
      FROM public.company_invites i
      JOIN public.companies c ON c.id = i.company_id
      JOIN public.users u ON u.id = i.invited_by_user_id
      WHERE i.id = $1
        AND i.company_id = $2
      LIMIT 1
      `,
      [inviteId, companyId]
    );

    if (!rows.length) return res.status(404).json({ error: "Invite not found" });

    const inv = rows[0];
    if (inv.status !== "PENDING") {
      return res.status(409).json({ error: "Invite is not pending" });
    }

    // If expired, rotate token + bump expiry
    const now = new Date();
    let token = inv.token;
    let expiresAt = inv.expires_at ? new Date(inv.expires_at) : null;

    if (!expiresAt || expiresAt <= now) {
      token = makeToken();
      expiresAt = new Date(Date.now() + INVITE_EXPIRES_HOURS * 60 * 60 * 1000);

      await pool.query(
        `
        UPDATE public.company_invites
        SET token = $1, expires_at = $2
        WHERE id = $3
        `,
        [token, expiresAt, inviteId]
      );
    }

    const inviterName = inv.inviter_name || inv.inviter_email || "A teammate";
    const companyName = inv.company_name || "Carrier Shark";

    await sendTeamInviteEmail({
      to: inv.invited_email,
      inviter_name: inviterName,
      company_name: companyName,
      invite_url: inviteUrl(req, token),
      expires_hours: INVITE_EXPIRES_HOURS,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/team/invites/resend error:", err);
    return res.status(500).json({ error: "Failed to resend invite" });
  }
});

/**
 * POST /api/team/invites/revoke
 * body: { invite_id }
 */
router.post("/team/invites/revoke", requireAuth, loadCompanyContext, async (req, res) => {
  const companyId = req.companyContext?.companyId;
  if (!companyId) return res.status(400).json({ error: "No company context" });
  if (!requireCompanyAdmin(req, res)) return;

  const inviteId = req.body?.invite_id;
  if (!inviteId) return res.status(400).json({ error: "Missing invite_id" });

  try {
    const result = await pool.query(
      `
      UPDATE public.company_invites
      SET status = 'REVOKED'
      WHERE id = $1
        AND company_id = $2
        AND status = 'PENDING'
      RETURNING id
      `,
      [inviteId, companyId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Invite not found (or not pending)" });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/team/invites/revoke error:", err);
    return res.status(500).json({ error: "Failed to revoke invite" });
  }
});

/**
 * POST /api/team/members/disable
 * body: { member_id }
 * sets company_members.status = 'DISABLED'
 */
router.post("/team/members/disable", requireAuth, loadCompanyContext, async (req, res) => {
  const companyId = req.companyContext?.companyId;
  if (!companyId) return res.status(400).json({ error: "No company context" });
  if (!requireCompanyAdmin(req, res)) return;

  const memberId = req.body?.member_id;
  if (!memberId) return res.status(400).json({ error: "Missing member_id" });

  try {
    // Load member first to enforce rules
    const m = await pool.query(
      `
      SELECT id, user_id, role, status
      FROM public.company_members
      WHERE id = $1
        AND company_id = $2
      LIMIT 1
      `,
      [memberId, companyId]
    );

    if (!m.rows.length) return res.status(404).json({ error: "Member not found" });

    const member = m.rows[0];

    if (member.role === "OWNER") {
      return res.status(409).json({ error: "You cannot disable the OWNER." });
    }

    if (Number(member.user_id) === Number(req.session.userId)) {
      return res.status(409).json({ error: "You cannot disable yourself." });
    }

    await pool.query(
      `
      UPDATE public.company_members
      SET status = 'DISABLED'
      WHERE id = $1
        AND company_id = $2
      `,
      [memberId, companyId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/team/members/disable error:", err);
    return res.status(500).json({ error: "Failed to disable member" });
  }
});

module.exports = router;
