"use strict";

const express = require("express");
const { pool } = require("../../db/pool");
const { spaces } = require("../../clients/spacesS3v2");
const crypto = require("crypto");
const router = express.Router();
const { sendContractOtpEmail } = require("../../clients/mailgun");


const OTP_EXPIRES_MIN = 5;
const MFA_VALID_MIN = 10;
const MAX_ATTEMPTS = 6;
const LOCK_MIN = 15;

function generateOtp6() {
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, "0");
}

function hashOtp({ otp, contractId }) {
  const secret = process.env.OTP_SECRET;
  if (!secret) throw new Error("Missing OTP_SECRET");
  return crypto.createHmac("sha256", secret).update(`${otp}|${contractId}`).digest("hex");
}

function maskEmail(email) {
  const [u, d] = String(email || "").split("@");
  if (!d) return "****";
  const um = u.length <= 2 ? `${u[0] || "*"}*` : `${u[0]}***${u[u.length - 1]}`;
  const d0 = d.split(".")[0] || "";
  const dm = d0.length <= 2 ? `${d0[0] || "*"}*` : `${d0[0]}***${d0[d0.length - 1]}`;
  return `${um}@${dm}.*`;
}



/** ---------- CONTRACT PDF (token-gated) ---------- **/
router.get("/contract/:token/pdf", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).send("Missing token");

  try {
    const sql = `
      SELECT
        c.contract_id,
        c.status,
        c.token_expires_at,
        uc.storage_provider,
        uc.storage_key,
        uc.name AS contract_name
      FROM public.contracts c
      JOIN public.user_contracts uc
        ON uc.id = c.user_contract_id
      WHERE c.token = $1
      LIMIT 1;
    `;

    const { rows } = await pool.query(sql, [token]);
    if (rows.length === 0) return res.status(404).send("Invalid link");

    const row = rows[0];

    if (row.token_expires_at && new Date(row.token_expires_at) < new Date()) {
      return res.status(410).send("This link has expired");
    }

    if (row.storage_provider !== "DO_SPACES") {
      return res.status(500).send("Storage provider not configured");
    }
    if (!row.storage_key) {
      return res.status(500).send("Missing storage key");
    }

    const Bucket = process.env.SPACES_BUCKET;
    const Key = row.storage_key;

    const obj = spaces.getObject({ Bucket, Key }).createReadStream();

    obj.on("error", (err) => {
      console.error("SPACES getObject error:", err?.code, err?.message, err);
      if (err?.code === "NoSuchKey") return res.status(404).send("PDF not found");
      return res.status(500).send("Failed to load PDF");
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=\"contract.pdf\"");
    res.setHeader("Cache-Control", "no-store");

    obj.pipe(res);
  } catch (err) {
    console.error("GET /contract/:token/pdf error:", err?.message, err);
    return res.status(500).send("Server error");
  }
});

/** ---------- CONTRACT LANDING PAGE (token + ACK UI) ---------- **/
router.get("/contract/:token", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).send("Missing token");

  try {
    const { rows } = await pool.query(
      `
      SELECT contract_id, token_expires_at, status
      FROM public.contracts
      WHERE token = $1
      LIMIT 1;
      `,
      [token]
    );

    if (rows.length === 0) return res.status(404).send("Invalid link");

    const contract = rows[0];
    if (contract.token_expires_at && new Date(contract.token_expires_at) < new Date()) {
      return res.status(410).send("This link has expired");
    }

    await pool.query(
      `
      UPDATE public.contracts
      SET status = 'VIEWED', updated_at = NOW()
      WHERE token = $1 AND status NOT IN ('VIEWED','ACKNOWLEDGED','SIGNED');
      `,
      [token]
    );

    const pdfUrl = `/contract/${encodeURIComponent(token)}/pdf`;
    const alreadyAccepted = (contract.status === "ACKNOWLEDGED" || contract.status === "SIGNED");

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(`<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Carrier Agreement</title>
  <style>
    body { margin:0; font-family: Arial, sans-serif; background:#0b1220; color:#e6eefc; }
    .wrap { max-width: 980px; margin: 0 auto; padding: 20px; }
    .top { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
    .brand { font-weight:800; letter-spacing:0.2px; }
    .btn { display:inline-block; padding:10px 14px; border-radius:10px; background:#2b6cff; color:#fff; text-decoration:none; font-weight:700; }
    .card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 12px; }
    iframe { width:100%; height: 70vh; border:0; border-radius: 12px; background:#fff; }
    .muted { opacity:0.85; font-size: 13px; margin-top:10px; }
    .form { margin-top: 14px; display:grid; gap:10px; }
    .row { display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
    .row > div { display:flex; flex-direction:column; gap:6px; }
    label { font-size: 13px; opacity:0.9; }
    input[type="text"], input[type="email"] {
      padding:10px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.18);
      background: rgba(255,255,255,0.06); color:#e6eefc; outline:none;
    }
    input[type="checkbox"] { transform: scale(1.2); }
    .checkline { display:flex; gap:10px; align-items:flex-start; }
    .submitline { display:flex; gap:10px; align-items:center; justify-content:space-between; flex-wrap:wrap; }
    .btn2 { padding:12px 16px; border-radius:10px; background:#22c55e; color:#06220f; border:0; font-weight:800; cursor:pointer; }
    .btn2[disabled] { opacity:0.6; cursor:not-allowed; }
    .msg { font-size: 14px; }
    .ok { color: #86efac; }
    .err { color: #fca5a5; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div class="brand">Carrier Shark — Carrier Agreement</div>
      <a class="btn" href="${pdfUrl}" target="_blank" rel="noopener">Open PDF</a>
    </div>

    <div class="card">
      <iframe src="${pdfUrl}"></iframe>
      <div class="muted">If the PDF doesn’t display on your device, tap “Open PDF”.</div>

      <div class="form" id="ackWrap">
        ${
          alreadyAccepted
            ? `<div class="msg ok"><strong>Accepted.</strong> This agreement has already been acknowledged.</div>`
            : `
        <div class="checkline">
          <input id="ack" type="checkbox" />
          <div>
            <div style="font-weight:700;">I acknowledge and accept this agreement.</div>
            <div class="muted">By submitting, you confirm you are authorized to accept on behalf of the carrier.</div>
          </div>
        </div>

        <div class="row">
          <div>
            <label for="name">Name</label>
            <input id="name" type="text" placeholder="Full name" />
          </div>
          <div>
            <label for="title">Title</label>
            <input id="title" type="text" placeholder="Owner / Dispatcher / Safety" />
          </div>
        </div>

        <div>
          <label for="email">Email (optional)</label>
          <input id="email" type="email" placeholder="name@company.com" />
        </div>

        <div class="submitline">
          <button id="submitBtn" class="btn2">Accept Agreement</button>
          <div id="msg" class="msg"></div>
        </div>
            `
        }
      </div>
    </div>
  </div>

  <script>
    (function () {
      const alreadyAccepted = ${alreadyAccepted ? "true" : "false"};
      if (alreadyAccepted) return;

      const token = ${JSON.stringify(token)};
      const ackEl = document.getElementById("ack");
      const nameEl = document.getElementById("name");
      const titleEl = document.getElementById("title");
      const emailEl = document.getElementById("email");
      const btn = document.getElementById("submitBtn");
      const msg = document.getElementById("msg");

      function setMsg(text, cls) {
        msg.className = "msg " + (cls || "");
        msg.textContent = text || "";
      }

      btn.addEventListener("click", async () => {
        setMsg("");
      
        const ack = ackEl.checked;
        const name = (nameEl.value || "").trim();
        const title = (titleEl.value || "").trim();
        const email = (emailEl.value || "").trim();
      
        if (!ack) return setMsg("Please check the acknowledgment box.", "err");
        if (!name) return setMsg("Name is required.", "err");
        if (!title) return setMsg("Title is required.", "err");
      
        btn.disabled = true;
        btn.textContent = "Verifying...";
      
        try {
          // 1️⃣ Start MFA
          const startResp = await fetch("/contract/" + encodeURIComponent(token) + "/mfa/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
          });
      
          const startData = await startResp.json().catch(() => ({}));
          if (!startResp.ok) {
            throw new Error(startData.error || "Failed to send authentication code.");
          }
      
          // 2️⃣ If not already validated, prompt for OTP
          if (startData.status !== "MFA_ALREADY_VALID") {
            const deliveryTarget = startData.deliveryTarget || "your email";
            const code = window.prompt("Enter the 6-digit code sent to " + deliveryTarget + ":");
      
            if (!code) throw new Error("Authentication code required.");
      
            const verifyResp = await fetch("/contract/" + encodeURIComponent(token) + "/mfa/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mfa_event_id: startData.mfa_event_id,
                otp: code
              })
            });
      
            const verifyData = await verifyResp.json().catch(() => ({}));
            if (!verifyResp.ok) {
              throw new Error(verifyData.error || "Invalid authentication code.");
            }
          }
      
          // 3️⃣ Now submit ACK
          btn.textContent = "Submitting...";
      
          const resp = await fetch("/contract/" + encodeURIComponent(token) + "/ack", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ack: true, name, title, email: email || null })
          });
      
          const data = await resp.json().catch(() => ({}));
      
          if (!resp.ok) {
            setMsg(data.error || "Failed to submit.", "err");
            btn.disabled = false;
            btn.textContent = "Accept Agreement";
          } else {
            setMsg("Accepted. You may close this page.", "ok");
            btn.textContent = "Accepted";
            btn.disabled = true;
          }
        } catch (e) {
          setMsg(e.message || "Network error. Please try again.", "err");
          btn.disabled = false;
          btn.textContent = "Accept Agreement";
        }
      });

    })();
  </script>
</body>
</html>`);
  } catch (err) {
    console.error("GET /contract/:token error:", err?.message, err);
    return res.status(500).send("Server error");
  }
});


router.post("/contract/:token/mfa/start", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).json({ error: "Missing token" });

  const accepted_ip =
    (req.headers["x-forwarded-for"]
      ? String(req.headers["x-forwarded-for"]).split(",")[0].trim()
      : null) ||
    req.ip ||
    null;

  const accepted_user_agent = req.get("user-agent") || null;

  const client = await pool.connect();
  try {
    // 1) Load contract + email_to
    const { rows } = await client.query(
      `
      SELECT contract_id, token_expires_at, email_to
      FROM public.contracts
      WHERE token = $1
      LIMIT 1;
      `,
      [token]
    );

    if (!rows.length) return res.status(404).json({ error: "Invalid link" });

    const { contract_id, token_expires_at, email_to } = rows[0];

    if (token_expires_at && new Date(token_expires_at) < new Date()) {
      return res.status(410).json({ error: "This link has expired" });
    }

    if (!email_to) {
      // You can choose to allow OTP to "email (optional)" instead,
      // but enterprise posture is better if OTP goes to the known recipient.
      return res.status(400).json({ error: "Missing recipient email for this contract" });
    }

    // 2) If already verified recently, no need to resend
    const already = await client.query(
      `
      SELECT id, otp_verified_at
      FROM public.contract_mfa_events
      WHERE contract_id = $1
        AND otp_verified_at IS NOT NULL
        AND otp_verified_at > now() - interval '${MFA_VALID_MIN} minutes'
      ORDER BY otp_verified_at DESC
      LIMIT 1;
      `,
      [contract_id]
    );

    if (already.rows.length) {
      return res.json({
        status: "MFA_ALREADY_VALID",
        validForSeconds: MFA_VALID_MIN * 60,
      });
    }

    // 3) Basic resend cooldown: if last OTP created < 30s ago, block
    const recent = await client.query(
      `
      SELECT otp_created_at
      FROM public.contract_mfa_events
      WHERE contract_id = $1
        AND otp_verified_at IS NULL
        AND expires_at > now()
      ORDER BY otp_created_at DESC
      LIMIT 1;
      `,
      [contract_id]
    );

    if (recent.rows.length) {
      const createdAt = new Date(recent.rows[0].otp_created_at).getTime();
      if (Date.now() - createdAt < 30_000) {
        return res.status(429).json({ error: "OTP_RECENTLY_SENT" });
      }
    }

    // 4) Invalidate old unverified OTP events (optional but clean)
    await client.query(
      `
      UPDATE public.contract_mfa_events
      SET expires_at = now()
      WHERE contract_id = $1
        AND otp_verified_at IS NULL
        AND expires_at > now();
      `,
      [contract_id]
    );

    const otp = generateOtp6();
    const otp_hash = hashOtp({ otp, contractId: contract_id });
    const expires_at = new Date(Date.now() + OTP_EXPIRES_MIN * 60 * 1000);
    const delivery_target = maskEmail(email_to);

    // 5) Insert MFA event
    const ins = await client.query(
      `
      INSERT INTO public.contract_mfa_events
        (contract_id, user_id, delivery_channel, delivery_target, otp_hash, expires_at, otp_ip, otp_user_agent, metadata)
      VALUES
        ($1, NULL, 'email', $2, $3, $4, $5, $6, jsonb_build_object('token', $7))
      RETURNING id;
      `,
      [contract_id, delivery_target, otp_hash, expires_at, accepted_ip, accepted_user_agent, token]
    );

    const mfa_event_id = ins.rows[0].id;

    // 6) Send email OTP
    await sendContractOtpEmail({ to: email_to, otp });

    await client.query(
      `UPDATE public.contract_mfa_events
       SET delivered_at = now()
       WHERE id = $1`,
      [mfa_event_id]
    );

    return res.json({
      status: "OTP_SENT",
      mfa_event_id,
      deliveryTarget: delivery_target,
      expiresInSeconds: OTP_EXPIRES_MIN * 60,
    });
  } catch (err) {
    console.error("POST /contract/:token/mfa/start error:", err?.message, err);
    return res.status(500).json({ error: "Failed to start MFA" });
  } finally {
    client.release();
  }
});


router.post("/contract/:token/mfa/verify", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).json({ error: "Missing token" });

  const { mfa_event_id, otp } = req.body || {};
  if (!mfa_event_id || !otp) return res.status(400).json({ error: "mfa_event_id and otp are required" });

  const accepted_ip =
    (req.headers["x-forwarded-for"]
      ? String(req.headers["x-forwarded-for"]).split(",")[0].trim()
      : null) ||
    req.ip ||
    null;

  const accepted_user_agent = req.get("user-agent") || null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Load contract
    const contractRes = await client.query(
      `
      SELECT contract_id, token_expires_at
      FROM public.contracts
      WHERE token = $1
      LIMIT 1;
      `,
      [token]
    );

    if (!contractRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Invalid link" });
    }

    const { contract_id, token_expires_at } = contractRes.rows[0];

    if (token_expires_at && new Date(token_expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return res.status(410).json({ error: "This link has expired" });
    }

    // Lock MFA event row
    const evRes = await client.query(
      `
      SELECT *
      FROM public.contract_mfa_events
      WHERE id = $1 AND contract_id = $2
      FOR UPDATE;
      `,
      [mfa_event_id, contract_id]
    );

    if (!evRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "MFA event not found" });
    }

    const ev = evRes.rows[0];

    if (ev.otp_verified_at) {
      await client.query("COMMIT");
      return res.json({ status: "ALREADY_VERIFIED", validForSeconds: MFA_VALID_MIN * 60 });
    }

    if (ev.locked_until && new Date(ev.locked_until) > new Date()) {
      await client.query("ROLLBACK");
      return res.status(429).json({ error: "LOCKED", lockedUntil: ev.locked_until });
    }

    if (new Date(ev.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "EXPIRED" });
    }

    const candidate = hashOtp({ otp: String(otp).trim(), contractId: contract_id });

    let ok = false;
    try {
      ok = crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(ev.otp_hash, "hex"));
    } catch {
      ok = false;
    }

    if (!ok) {
      const nextAttempts = (ev.attempt_count || 0) + 1;
      let lockedUntil = null;

      if (nextAttempts >= MAX_ATTEMPTS) {
        lockedUntil = new Date(Date.now() + LOCK_MIN * 60 * 1000);
      }

      await client.query(
        `
        UPDATE public.contract_mfa_events
        SET attempt_count = $2,
            locked_until = COALESCE($3, locked_until)
        WHERE id = $1;
        `,
        [mfa_event_id, nextAttempts, lockedUntil]
      );

      await client.query("COMMIT");
      return res.status(400).json({
        error: "INVALID_OTP",
        attemptsRemaining: Math.max(0, MAX_ATTEMPTS - nextAttempts),
        lockedUntil,
      });
    }

    await client.query(
      `
      UPDATE public.contract_mfa_events
      SET otp_verified_at = now(),
          otp_ip = $2,
          otp_user_agent = $3
      WHERE id = $1;
      `,
      [mfa_event_id, accepted_ip, accepted_user_agent]
    );

    await client.query("COMMIT");
    return res.json({ status: "VERIFIED", validForSeconds: MFA_VALID_MIN * 60 });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("POST /contract/:token/mfa/verify error:", err?.message, err);
    return res.status(500).json({ error: "Failed to verify OTP" });
  } finally {
    client.release();
  }
});







/** ---------- CONTRACT ACK (token-gated) ---------- **/
router.post("/contract/:token/ack", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).json({ error: "Missing token" });

  const { ack, name, title, email } = req.body || {};

  if (ack !== true) return res.status(400).json({ error: "ack must be true" });
  if (!name || !String(name).trim()) return res.status(400).json({ error: "name is required" });
  if (!title || !String(title).trim()) return res.status(400).json({ error: "title is required" });

  const accepted_name = String(name).trim();
  const accepted_title = String(title).trim();
  const accepted_email = email ? String(email).trim() : null;

  const accepted_ip =
    (req.headers["x-forwarded-for"]
      ? String(req.headers["x-forwarded-for"]).split(",")[0].trim()
      : null) ||
    req.ip ||
    null;

  const accepted_user_agent = req.get("user-agent") || null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const contractRes = await client.query(
      `
      SELECT contract_id, token_expires_at
      FROM public.contracts
      WHERE token = $1
      LIMIT 1;
      `,
      [token]
    );

    if (contractRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Invalid link" });
    }

    const contract_id = contractRes.rows[0].contract_id;
    const token_expires_at = contractRes.rows[0].token_expires_at;

    

    if (token_expires_at && new Date(token_expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return res.status(410).json({ error: "This link has expired" });
    }

    // Require MFA verified within last 10 minutes
    const mfaOk = await client.query(
      `
      SELECT id
      FROM public.contract_mfa_events
      WHERE contract_id = $1
        AND otp_verified_at IS NOT NULL
        AND otp_verified_at > now() - interval '${MFA_VALID_MIN} minutes'
      ORDER BY otp_verified_at DESC
      LIMIT 1;
      `,
      [contract_id]
    );
    
    if (!mfaOk.rows.length) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "MFA_REQUIRED" });
    }
    
    const mfa_event_id = mfaOk.rows[0].id;


    
    await client.query(
      `
      INSERT INTO public.contract_acceptances
        (contract_id, method, accepted_name, accepted_title, accepted_email, accepted_ip, accepted_user_agent, mfa_event_id)
      VALUES
        ($1, 'ACK', $2, $3, $4, $5, $6, $7)
      ON CONFLICT (contract_id) DO UPDATE
        SET method = EXCLUDED.method,
            accepted_name = EXCLUDED.accepted_name,
            accepted_title = EXCLUDED.accepted_title,
            accepted_email = EXCLUDED.accepted_email,
            accepted_at = NOW(),
            accepted_ip = EXCLUDED.accepted_ip,
            accepted_user_agent = EXCLUDED.accepted_user_agent,
            mfa_event_id = EXCLUDED.mfa_event_id;
      `,
      [contract_id, accepted_name, accepted_title, accepted_email, accepted_ip, accepted_user_agent, mfa_event_id]
    );


    await client.query(
      `
      UPDATE public.contracts
      SET status = 'ACKNOWLEDGED',
          signed_at = NOW(),
          updated_at = NOW()
      WHERE contract_id = $1;
      `,
      [contract_id]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, contract_id, status: "ACKNOWLEDGED" });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("POST /contract/:token/ack error:", err?.message, err);
    return res.status(500).json({ error: "Failed to acknowledge contract" });
  } finally {
    client.release();
  }
});

module.exports = router;
