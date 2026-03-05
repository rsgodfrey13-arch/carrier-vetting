"use strict";

const express = require("express");
const { pool } = require("../../db/pool");
const { spaces } = require("../../clients/spacesS3v2");
const crypto = require("crypto");
const router = express.Router();
const {
  sendContractOtpEmail,
  sendCarrierContractAcceptedEmail,
  sendBrokerContractAcceptedEmail,
} = require("../../clients/mailgun");


const OTP_EXPIRES_MIN = 5;
const MFA_VALID_MIN = 10;
const MAX_ATTEMPTS = 6;
const LOCK_MIN = 15;

function escapeHtmlServer(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


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

router.get("/contract/:token/certificate", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).send("Missing token");

  try {
    const { rows } = await pool.query(
      `
      SELECT
        c.contract_id,
        c.status,
        c.dotnumber,
        c.email_to,
        c.sent_at,
        c.signed_at,
        c.token_expires_at,
        uc.name AS agreement_type,
        uc.display_name AS broker_name,
        ca.accepted_at,
        ca.accepted_name,
        ca.accepted_title,
        ca.accepted_email,
        ca.accepted_ip,
        ca.accepted_user_agent,
        ca.document_hash_sha256,
        ca.document_storage_key
      FROM public.contracts c
      JOIN public.user_contracts uc ON uc.id = c.user_contract_id
      LEFT JOIN public.contract_acceptances ca ON ca.contract_id = c.contract_id
      WHERE c.token = $1
      LIMIT 1;
      `,
      [token]
    );

    if (!rows.length) return res.status(404).send("Invalid link");

    const r = rows[0];
    if (r.token_expires_at && new Date(r.token_expires_at) < new Date()) {
      return res.status(410).send("This link has expired");
    }

    const accepted = (r.status === "ACKNOWLEDGED" || r.status === "SIGNED");
    const acceptedAt = r.accepted_at ? new Date(r.accepted_at).toISOString() : "";
    const signedAt = r.signed_at ? new Date(r.signed_at).toISOString() : "";

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    return res.send(`<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Signature Certificate</title>
  <style>
    body{ font-family: Arial, sans-serif; margin:24px; color:#111; }
    .wrap{ max-width:900px; margin:0 auto; }
    .h{ font-size:22px; font-weight:800; margin-bottom:10px; }
    .sub{ color:#444; margin-bottom:18px; }
    .box{ border:1px solid #ddd; border-radius:10px; padding:14px; margin:12px 0; }
    .row{ display:flex; gap:14px; flex-wrap:wrap; }
    .col{ flex:1; min-width:260px; }
    .k{ font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:#666; }
    .v{ font-size:15px; margin-top:4px; word-break:break-word; }
    .badge{ display:inline-block; padding:6px 10px; border-radius:999px; background:#eef6ff; border:1px solid #cfe3ff; font-weight:700; }
    .muted{ color:#666; font-size:13px; line-height:1.45; }
    .btn{ display:inline-block; margin-top:10px; padding:10px 12px; border-radius:10px; border:1px solid #ddd; text-decoration:none; color:#111; font-weight:700; }
    @media print { .noPrint{ display:none; } body{ margin:0.5in; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="h">Signature Certificate</div>
    <div class="sub">
      This certificate records the electronic acceptance of an agreement delivered via Carrier Shark.
      ${accepted ? `<span class="badge">Accepted</span>` : `<span class="badge">Not yet accepted</span>`}
    </div>

    <div class="box">
      <div class="row">
        <div class="col">
          <div class="k">Agreement Type</div>
          <div class="v">${escapeHtmlServer(r.agreement_type || "Carrier Agreement")}</div>
        </div>
        <div class="col">
          <div class="k">Broker / Sender</div>
          <div class="v">${escapeHtmlServer(r.broker_name || "")}</div>
        </div>
      </div>
      <div class="row" style="margin-top:10px;">
        <div class="col">
          <div class="k">Carrier DOT</div>
          <div class="v">${escapeHtmlServer(String(r.dotnumber || ""))}</div>
        </div>
        <div class="col">
          <div class="k">Original Recipient Email</div>
          <div class="v">${escapeHtmlServer(String(r.email_to || ""))}</div>
        </div>
      </div>
    </div>

    <div class="box">
      <div class="row">
        <div class="col">
          <div class="k">Accepted Name</div>
          <div class="v">${escapeHtmlServer(r.accepted_name || "")}</div>
        </div>
        <div class="col">
          <div class="k">Accepted Title</div>
          <div class="v">${escapeHtmlServer(r.accepted_title || "")}</div>
        </div>
      </div>
      <div class="row" style="margin-top:10px;">
        <div class="col">
          <div class="k">Accepted Email</div>
          <div class="v">${escapeHtmlServer(r.accepted_email || "")}</div>
        </div>
        <div class="col">
          <div class="k">Accepted At (UTC)</div>
          <div class="v">${escapeHtmlServer(acceptedAt)}</div>
        </div>
      </div>
      <div class="row" style="margin-top:10px;">
        <div class="col">
          <div class="k">IP Address</div>
          <div class="v">${escapeHtmlServer(r.accepted_ip || "")}</div>
        </div>
        <div class="col">
          <div class="k">User Agent</div>
          <div class="v">${escapeHtmlServer(r.accepted_user_agent || "")}</div>
        </div>
      </div>
    </div>

    <div class="box">
      <div class="k">Document Hash (SHA-256)</div>
      <div class="v">${escapeHtmlServer(r.document_hash_sha256 || "")}</div>
      <div class="muted" style="margin-top:8px;">
        This hash identifies the exact PDF content that was accepted.
      </div>
    </div>

    <div class="box">
      <div class="muted">
        Carrier Shark provides technology for delivery and electronic acceptance and is not a party to the agreement.
        Parties are responsible for verifying identity and authority.
      </div>
    </div>

    <div class="noPrint">
      <a class="btn" href="/contract/${encodeURIComponent(token)}/pdf" target="_blank" rel="noopener">Open Contract PDF</a>
      <a class="btn" href="#" onclick="window.print(); return false;">Print / Save as PDF</a>
    </div>
  </div>

  <script>
    function escapeHtmlServer(str){
      return String(str||"")
        .replaceAll("&","&amp;")
        .replaceAll("<","&lt;")
        .replaceAll(">","&gt;")
        .replaceAll('"',"&quot;")
        .replaceAll("'","&#039;");
    }
  </script>
</body>
</html>`);
  } catch (err) {
    console.error("GET /contract/:token/certificate error:", err?.message, err);
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

/* modal (same vibe as account modal) */
.modal-backdrop{
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.55);
  display:none;
  align-items:center;
  justify-content:center;
  padding: 18px;
  z-index: 9999;
}
.modal-backdrop.is-open{ display:flex; }
.modal{
  width: min(520px, 100%);
  background: rgba(15,23,42,0.98);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 16px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.45);
  overflow:hidden;
}
.modal-head{
  display:flex; align-items:center; justify-content:space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.10);
}
.modal-head h3{ margin:0; font-size: 16px; }
.icon-btn{
  background: transparent;
  border: 0;
  color: #e6eefc;
  font-size: 18px;
  cursor:pointer;
}
.modal-body{ padding: 14px 16px; }
.field-label{ font-size: 13px; opacity: 0.9; display:block; margin-bottom:6px; }
.field-input{
  width:100%;
  padding: 12px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.06);
  color:#e6eefc;
  outline:none;
}
.modal-actions{
  display:flex; gap:10px; justify-content:flex-end;
  padding: 14px 16px;
  border-top: 1px solid rgba(255,255,255,0.10);
}
.btn-primary{
  padding: 12px 16px;
  border-radius: 10px;
  background: #22c55e;
  color:#06220f;
  border:0;
  font-weight: 800;
  cursor:pointer;
}
.btn-ghost{
  padding: 12px 16px;
  border-radius: 10px;
  background: rgba(255,255,255,0.08);
  color:#e6eefc;
  border: 1px solid rgba(255,255,255,0.12);
  cursor:pointer;
}
.form-error{
  margin-top:10px;
  color:#fca5a5;
}

/* success overlay */
.success-screen{
  position: fixed; inset: 0;
  display:flex;
  align-items:center;
  justify-content:center;
  background: #0b1220;
  z-index: 9000;
}
.success-card{
  width: min(640px, 92vw);
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 18px;
  padding: 22px;
  text-align:center;
}
.success-title{ font-size: 22px; font-weight: 900; }
.success-sub{ margin-top: 8px; opacity: 0.92; }


/* PDF: desktop vs mobile */
.pdfMobileCard { display:none; }

@media (max-width: 720px) {
  .wrap { padding: 14px; }
  iframe { height: 56vh; } /* still fine on some phones, but we’ll hide it */
  .pdfWrap { display:none !important; }

  .pdfMobileCard{
    display:block;
    padding:14px;
    border-radius:16px;
    border:1px solid rgba(255,255,255,0.12);
    background:rgba(255,255,255,0.06);
    margin-bottom:14px;
  }
  .pdfMobileTitle{ font-weight:900; font-size:18px; }
  .pdfMobileSub{ opacity:.85; margin-top:6px; font-size:14px; line-height:1.35; }
  .pdfMobileBtn{
    display:inline-block;
    margin-top:10px;
    padding:12px 14px;
    border-radius:12px;
    background:#2b6cff;
    color:#fff;
    font-weight:800;
    text-decoration:none;
  }
}

@media (max-width: 720px) {
  .top { flex-direction: row; }
  .brand { font-size: 18px; }
  .row { grid-template-columns: 1fr; } /* stack Name/Title */
}
    
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div class="brand">Carrier Shark — Carrier Agreement</div>
      <a class="btn" href="${pdfUrl}" target="_blank" rel="noopener">Open PDF</a>
    </div>

    <div class="card">
      <div class="pdfWrap">
        <iframe src="${pdfUrl}"></iframe>
        <div class="muted">If the PDF doesn’t display on your device, tap “Open PDF”.</div>
      </div>
      
      <div class="pdfMobileCard">
        <div class="pdfMobileTitle">Carrier Agreement</div>
        <div class="pdfMobileSub">
          Tap below to review the agreement in a clean PDF viewer.
        </div>
        <a class="pdfMobileBtn" href="${pdfUrl}" target="_blank" rel="noopener">Open PDF</a>
      </div>

      <div class="form" id="ackWrap">
        ${
          alreadyAccepted
            ? `<div class="msg ok"><strong>Accepted.</strong> This agreement has already been acknowledged.</div>`
            : `
<div class="card" style="margin-top:14px; background: rgba(255,255,255,0.04);">
  <div style="font-size:13px; line-height:1.5;">
    <strong>Platform Notice:</strong><br/>
    Carrier Shark provides technology for document delivery and electronic acceptance.
    Carrier Shark is <strong>not a party</strong> to this agreement and assumes no obligations under it.
    Carrier Shark does not verify identity, authority, insurance coverage, or regulatory status of any party.
    Users are responsible for independent verification.
  </div>
</div>

<div class="checkline" style="margin-top:14px;">
  <input id="ack" type="checkbox" />
  <div>
    <div style="font-weight:700;">
      I acknowledge and accept this agreement.
    </div>
    <div class="muted">
      By submitting, you represent that you are authorized to accept on behalf of the carrier.
    </div>
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
        
<div class="card" style="margin-top:16px;">
  <div style="font-weight:700; margin-bottom:8px;">
    ACH / Payment Information (Optional)
  </div>

  <div class="muted" style="margin-bottom:10px;">
    Upload a voided check or ACH form for the broker's accounting team.
  </div>

  <input type="file" id="achUpload" accept=".pdf,.png,.jpg,.jpeg" />

  <button id="uploadAchBtn" class="btn2" style="margin-top:10px;">
    Upload ACH Document
  </button>

  <div id="achMsg" class="msg"></div>
</div>       `
        }
      </div>
    </div>
  </div>

  <script>

  function openOtpModal(deliveryTarget) {
  const m = document.getElementById("otp-modal");
  const sub = document.getElementById("otp-sub");
  const input = document.getElementById("otp-code");
  const err = document.getElementById("otp-error");

  if (sub) sub.textContent = "Enter the 6-digit code sent to " + (deliveryTarget || "your email") + ".";
  if (err) { err.style.display = "none"; err.textContent = ""; }
  if (input) input.value = "";

  m.classList.add("is-open");
  m.setAttribute("aria-hidden", "false");
  setTimeout(() => input?.focus(), 0);
}

function closeOtpModal() {
  const m = document.getElementById("otp-modal");
  if (!m) return;
  m.classList.remove("is-open");
  m.setAttribute("aria-hidden", "true");
}

function otpError(msg) {
  const err = document.getElementById("otp-error");
  if (!err) return;
  err.textContent = msg || "Invalid code.";
  err.style.display = "block";
}

function waitForOtp() {
  return new Promise((resolve, reject) => {
    const input = document.getElementById("otp-code");
    const verifyBtn = document.getElementById("otp-verify");
    const cancelBtn = document.getElementById("otp-cancel");
    const closeBtn  = document.getElementById("otp-close");
    const modal     = document.getElementById("otp-modal");

    function cleanup() {
      verifyBtn?.removeEventListener("click", onVerify);
      cancelBtn?.removeEventListener("click", onCancel);
      closeBtn?.removeEventListener("click", onCancel);
      modal?.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
      input?.removeEventListener("keydown", onEnter);
    }

    function onCancel() {
      cleanup();
      closeOtpModal();
      reject(new Error("Authentication cancelled."));
    }

    function onBackdrop(e) {
      if (e.target === modal) onCancel();
    }

    function onKey(e) {
      if (e.key === "Escape") onCancel();
    }

    function onEnter(e) {
      if (e.key === "Enter") onVerify();
    }

    function onVerify() {
      const raw = (input?.value || "").trim();
      const digits = raw.replace(/\D/g, ""); // keep only 0-9
    
      if (digits.length !== 6) return otpError("Enter a valid 6-digit code.");
    
      cleanup();
      closeOtpModal();
      resolve(digits);
    }

    verifyBtn?.addEventListener("click", onVerify);
    cancelBtn?.addEventListener("click", onCancel);
    closeBtn?.addEventListener("click", onCancel);
    modal?.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
    input?.addEventListener("keydown", onEnter);
  });
}
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

  openOtpModal(deliveryTarget);
  const code = await waitForOtp();

  const verifyResp = await fetch(
    "/contract/" + encodeURIComponent(token) + "/mfa/verify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mfa_event_id: startData.mfa_event_id,
        otp: code
      })
    }
  );

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
            document.getElementById("signed-screen").style.display = "flex";
            document.querySelector(".wrap").style.display = "none";
          }
        } catch (e) {
          setMsg(e.message || "Network error. Please try again.", "err");
          btn.disabled = false;
          btn.textContent = "Accept Agreement";
        }
      });

const achInput = document.getElementById("achUpload");
const achBtn = document.getElementById("uploadAchBtn");
const achMsg = document.getElementById("achMsg");

if (achBtn) {
  achBtn.addEventListener("click", async () => {
    const file = achInput.files[0];

    if (!file) {
      achMsg.textContent = "Please choose a file.";
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    achBtn.disabled = true;
    achBtn.textContent = "Uploading...";

    try {
      const resp = await fetch("/contract/" + encodeURIComponent(token) + "/ach-upload", {
        method: "POST",
        body: formData
      });

      const data = await resp.json();

      if (!resp.ok) throw new Error(data.error || "Upload failed");

      achMsg.textContent = "ACH document uploaded successfully.";
    } catch (err) {
      achMsg.textContent = err.message;
    }

    achBtn.disabled = false;
    achBtn.textContent = "Upload ACH Document";
  });
}
    })();

    
  </script>

<!-- OTP Modal -->
<div class="modal-backdrop" id="otp-modal" aria-hidden="true">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="otp-title">
    <div class="modal-head">
      <h3 id="otp-title">Confirm acceptance</h3>
      <button class="icon-btn" type="button" id="otp-close" aria-label="Close">✕</button>
    </div>

    <div class="modal-body">
      <div class="muted" id="otp-sub">Enter the 6-digit code we sent.</div>

      <div class="field" style="margin-top:12px;">
        <label class="field-label" for="otp-code">6-digit code</label>
        <input class="field-input" id="otp-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="123456" class="form-input" />
      </div>

      <div class="form-error" id="otp-error" style="display:none;"></div>
    </div>

    <div class="modal-actions">
      <button class="btn-ghost" type="button" id="otp-cancel">Cancel</button>
      <button class="btn-primary" type="button" id="otp-verify">Verify</button>
    </div>
  </div>
</div>

<!-- Success Screen (swap-in) -->
<div class="success-screen" id="signed-screen" style="display:none;">
  <div class="success-card">
    <div class="success-title">Thank you.</div>

    <div class="success-sub">
      This agreement has been signed successfully.
    </div>

    <div class="success-sub muted" style="margin-top:10px;">
      You can download a copy of the agreement below.
    </div>

    <div style="margin-top:20px; display:flex; gap:12px; flex-wrap:wrap; justify-content:center;">

      <a
        class="pdfMobileBtn"
        href="/contract/${token}/pdf"
        target="_blank"
        rel="noopener"
      >
        Open Contract PDF
      </a>

      <a
        class="pdfMobileBtn"
        href="/contract/${token}/certificate"
        target="_blank"
        rel="noopener"
      >
        Signature Certificate
      </a>

    </div>

  </div>
</div>

</body>
</html>`);
  } catch (err) {
    console.error("GET /contract/:token error:", err?.message, err);
    return res.status(500).send("Server error");
  }
});


router.post("/contract/:token/ach-upload", async (req, res) => {
  const token = req.params.token;

  try {
    const { rows } = await pool.query(
      `SELECT contract_id FROM contracts WHERE token = $1 LIMIT 1`,
      [token]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Invalid contract" });
    }

    const contractId = rows[0].contract_id;

    const file = req.files?.file;
    if (!file) return res.status(400).json({ error: "Missing file" });

    const key = `ach/${contractId}/${Date.now()}_${file.name}`;

    await spaces.putObject({
      Bucket: process.env.SPACES_BUCKET,
      Key: key,
      Body: file.data,
      ContentType: file.mimetype
    }).promise();

    await pool.query(
      `INSERT INTO contract_ach_documents (contract_id, storage_key)
       VALUES ($1, $2)`,
      [contractId, key]
    );

    res.json({ ok: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload failed" });
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
        ($1, NULL, 'email', $2, $3, $4, $5, $6, jsonb_build_object('token', $7::text))
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


router.post("/contract/:token/ack", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).json({ error: "Missing token" });

  const accepted_name = String(req.body?.name || "").trim();
  const accepted_title = String(req.body?.title || "").trim();
  const accepted_email = req.body?.email ? String(req.body.email).trim() : null;

  if (!accepted_name) return res.status(400).json({ error: "Name is required" });
  if (!accepted_title) return res.status(400).json({ error: "Title is required" });

  const accepted_ip =
    (req.headers["x-forwarded-for"]
      ? String(req.headers["x-forwarded-for"]).split(",")[0].trim()
      : null) ||
    req.ip ||
    null;

  const accepted_user_agent = req.get("user-agent") || null;

  const client = await pool.connect();

  try {
    // ============================================================
    // 1) Read-only lookups (NO transaction yet)
    // ============================================================

    // Load contract by token + expiry check
    const contractRes = await client.query(
      `
      SELECT contract_id, token_expires_at, user_contract_id, status
      FROM public.contracts
      WHERE token = $1
      LIMIT 1;
      `,
      [token]
    );

    if (!contractRes.rows.length) {
      return res.status(404).json({ error: "Invalid link" });
    }

    const { contract_id, token_expires_at, status } = contractRes.rows[0];

    if (token_expires_at && new Date(token_expires_at) < new Date()) {
      return res.status(410).json({ error: "This link has expired" });
    }

    // Optional: if you want idempotent “already accepted”
    if (status === "ACKNOWLEDGED" || status === "SIGNED") {
      return res.json({ ok: true, status });
    }

    // Load PDF storage metadata (same relationship you use in /pdf)
    const pdfMetaRes = await client.query(
      `
      SELECT uc.storage_provider, uc.storage_key
      FROM public.contracts c
      JOIN public.user_contracts uc
        ON uc.id = c.user_contract_id
      WHERE c.contract_id = $1
      LIMIT 1;
      `,
      [contract_id]
    );

    if (!pdfMetaRes.rows.length) {
      return res.status(500).json({ error: "Missing contract storage metadata" });
    }

    const { storage_provider, storage_key } = pdfMetaRes.rows[0];

    if (storage_provider !== "DO_SPACES" || !storage_key) {
      return res.status(500).json({ error: "Storage provider not configured" });
    }

    // Fetch PDF bytes from Spaces and compute hash (NO transaction yet)
    let document_hash_sha256;
    try {
      const obj = await spaces
        .getObject({ Bucket: process.env.SPACES_BUCKET, Key: storage_key })
        .promise();

      const pdfBuffer = obj.Body; // Buffer
      document_hash_sha256 = crypto
        .createHash("sha256")
        .update(pdfBuffer)
        .digest("hex");
    } catch (err) {
      console.error("Failed to load PDF for hashing:", err?.code, err?.message, err);
      return res.status(500).json({ error: "Failed to compute document hash" });
    }

    // ============================================================
    // 2) Transaction begins ONLY when we need to write
    // ============================================================

    const metaRes = await client.query(
      `
      SELECT
        c.dotnumber,
        c.email_to,
        c.user_id,
        uc.name        AS agreement_type,
        uc.display_name AS broker_name,
        u.email        AS broker_email,
        COALESCE(pc.dbaname,pc.legalname) AS carrier_name
      FROM public.contracts c
      JOIN public.user_contracts uc ON uc.id = c.user_contract_id
      JOIN public.users u ON u.id = c.user_id
      LEFT JOIN public.carriers pc on c.dotnumber = pc.dotnumber
      WHERE c.contract_id = $1
      LIMIT 1;
      `,
      [contract_id]
    );
    
    const meta = metaRes.rows[0] || {};
    
    await client.query("BEGIN");

    // (Optional but clean) Re-check token is still valid inside transaction
    const contractRes2 = await client.query(
      `
      SELECT contract_id, token_expires_at, status
      FROM public.contracts
      WHERE contract_id = $1
      LIMIT 1;
      `,
      [contract_id]
    );

    if (!contractRes2.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Contract not found" });
    }

    const { token_expires_at: token_expires_at2, status: status2 } = contractRes2.rows[0];

    if (token_expires_at2 && new Date(token_expires_at2) < new Date()) {
      await client.query("ROLLBACK");
      return res.status(410).json({ error: "This link has expired" });
    }

    // If another request acknowledged it between our first check and now:
    if (status2 === "ACKNOWLEDGED" || status2 === "SIGNED") {
      
    await client.query("COMMIT");

// send emails AFTER commit (so acceptance isn't lost if mailgun hiccups)
try {
  const baseUrl = process.env.APP_BASE_URL || "https://carriershark.com";
  const pdf_link = `${baseUrl}/contract/${encodeURIComponent(token)}/pdf`;
  const cert_link = `${baseUrl}/contract/${encodeURIComponent(token)}/certificate`;

  // Carrier email
  const toCarrier = [meta.email_to, accepted_email].filter(Boolean);
  const uniqueCarrier = [...new Set(toCarrier.map(x => String(x).trim().toLowerCase()))];

  if (uniqueCarrier.length) {
    await sendCarrierContractAcceptedEmail({
      to: uniqueCarrier,
      broker_name: meta.broker_name || "Carrier Shark Customer",
      carrier_name: meta.carrier_name || "",
      dotnumber: meta.dotnumber ? String(meta.dotnumber) : "",
      agreement_type: meta.agreement_type || "Carrier Agreement",
      pdf_link, cert_link
    });
  }

  // Broker email
  if (meta.broker_email) {
    await sendBrokerContractAcceptedEmail({
      to: String(meta.broker_email).trim().toLowerCase(),

      broker_name: meta.broker_name || "Carrier Shark Customer",
      carrier_name: meta.carrier_name || "",

      dotnumber: meta.dotnumber ? String(meta.dotnumber) : "",
      agreement_type: meta.agreement_type || "Carrier Agreement",

      accepted_name: accepted_name || "",
      accepted_title: accepted_title || "",
      accepted_email: accepted_email
        ? String(accepted_email).trim().toLowerCase()
        : "",

      pdf_link, cert_liink
    });
  }

} catch (e) {
  console.error("Contract acceptance email failed:", e?.message, e);
}
    
    return res.json({ ok: true });
    }

    // ============================================================
    // 3) MFA gate (must be inside transaction for correctness)
    // ============================================================

    const mfaOk = await client.query(
      `
      SELECT id
      FROM public.contract_mfa_events
      WHERE contract_id = $1
        AND otp_verified_at IS NOT NULL
        AND otp_verified_at > now() - interval '10 minutes'
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

    // ============================================================
    // 4) Insert acceptance (store hash + storage_key, never overwrite)
    // ============================================================

    await client.query(
      `
      INSERT INTO public.contract_acceptances
        (contract_id, method, accepted_name, accepted_title, accepted_email,
         accepted_ip, accepted_user_agent, mfa_event_id,
         document_hash_sha256, document_storage_key)
      VALUES
        ($1, 'ACK', $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (contract_id) DO UPDATE
        SET method = EXCLUDED.method,
            accepted_name = EXCLUDED.accepted_name,
            accepted_title = EXCLUDED.accepted_title,
            accepted_email = EXCLUDED.accepted_email,
            accepted_at = NOW(),
            accepted_ip = EXCLUDED.accepted_ip,
            accepted_user_agent = EXCLUDED.accepted_user_agent,
            mfa_event_id = EXCLUDED.mfa_event_id,

            -- prevent accidental future changes
            document_hash_sha256 = COALESCE(contract_acceptances.document_hash_sha256, EXCLUDED.document_hash_sha256),
            document_storage_key  = COALESCE(contract_acceptances.document_storage_key,  EXCLUDED.document_storage_key);
      `,
      [
        contract_id,
        accepted_name,
        accepted_title,
        accepted_email,
        accepted_ip,
        accepted_user_agent,
        mfa_event_id,
        document_hash_sha256,
        storage_key,
      ]
    );

    // ============================================================
    // 5) Update contract status/timestamps
    // ============================================================

    await client.query(
      `
      UPDATE public.contracts
      SET status = 'ACKNOWLEDGED',
          signed_at = COALESCE(signed_at, now())
      WHERE contract_id = $1;
      `,
      [contract_id]
    );

await client.query("COMMIT");

try {
  const baseUrl = process.env.APP_BASE_URL || "https://carriershark.com";
  const pdf_link = `${baseUrl}/contract/${encodeURIComponent(token)}/pdf`;
  const cert_link = `${baseUrl}/contract/${encodeURIComponent(token)}/certificate`;

  const toCarrier = [meta.email_to, accepted_email].filter(Boolean);
  const uniqueCarrier = [...new Set(toCarrier.map(x => String(x).trim().toLowerCase()))];

  if (uniqueCarrier.length) {
    await sendCarrierContractAcceptedEmail({
      to: uniqueCarrier,
      broker_name: meta.broker_name || "Carrier Shark Customer",
      carrier_name: meta.carrier_name || "",
      dotnumber: meta.dotnumber ? String(meta.dotnumber) : "",
      agreement_type: meta.agreement_type || "Carrier Agreement",
      pdf_link,
    });
  }

  if (meta.broker_email) {
    await sendBrokerContractAcceptedEmail({
      to: String(meta.broker_email).trim().toLowerCase(),
      broker_name: meta.broker_name || "Carrier Shark Customer",
      carrier_name: meta.carrier_name || "",
      dotnumber: meta.dotnumber ? String(meta.dotnumber) : "",
      agreement_type: meta.agreement_type || "Carrier Agreement",
      accepted_name: accepted_name || "",
      accepted_title: accepted_title || "",
      accepted_email: accepted_email ? String(accepted_email).trim().toLowerCase() : "",
      pdf_link,
    });
  }
} catch (e) {
  console.error("Contract acceptance email failed:", e?.message, e);
}

return res.json({ ok: true });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("POST /contract/:token/ack error:", err?.message, err);
    return res.status(500).json({ error: "Failed to accept contract" });
  } finally {
    client.release();
  }
});




module.exports = router;
