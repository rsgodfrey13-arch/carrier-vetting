/* static/js/pages/account.js */
(() => {
  const $ = (id) => document.getElementById(id);

  // -----------------------------
  // Tabs
  // -----------------------------
  const railItems = Array.from(document.querySelectorAll(".rail-item"));
  const panels = {
    overview: $("tab-overview"),
    alerts: $("tab-alerts"),
    agreements: $("tab-agreements"),
    api: $("tab-api"),
    plan: $("tab-plan"),
    security: $("tab-security"),
    help: $("tab-help"),
  };

  function setPlanBadge(planRaw) {
  const el = document.getElementById("plan-badge");
  if (!el) return;

  const tier = String(planRaw || "").trim().toLowerCase(); // "gold", "silver", etc

  // text
  el.textContent = tier ? tier.toUpperCase() : "—";

  // base class for the fancy badge styling
  el.classList.add("plan-badge");

  // clear old tier classes
  el.classList.remove("plan-bronze", "plan-silver", "plan-gold", "plan-platinum");

  // apply tier class (only if valid)
  const allowed = new Set(["bronze", "silver", "gold", "platinum"]);
  if (allowed.has(tier)) el.classList.add(`plan-${tier}`);
}


let activeTab = "overview";

function setActiveTab(name) {
  if (name === activeTab) return;
  activeTab = name;

  railItems.forEach((b) =>
    b.classList.toggle("is-active", b.dataset.tab === name)
  );
  Object.entries(panels).forEach(([k, el]) => {
    if (!el) return;
    el.classList.toggle("is-active", k === name);
  });

  if (name === "help") loadTickets().catch(console.error);
}



  railItems.forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });

  document.querySelectorAll("[data-tab-jump]").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tabJump));
  });

  // -----------------------------
  // Pills
  // -----------------------------
  function setPill(id, enabled) {
    const el = document.getElementById(id);
    if (!el) return;

    // IMPORTANT: you said these are booleans. So we only treat true/false as truthy/falsey.
    el.classList.toggle("is-on", enabled === true);
    el.classList.toggle("is-off", enabled === false);
  }

  // -----------------------------
  // API
  // -----------------------------
  
  let API_KEY_FULL = null;
  let WEBHOOK_ORIGINAL = "";
  
  async function apiGet(url) {
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) throw new Error(`GET ${url} failed: ${r.status}`);
    return r.json();
  }

  async function apiPost(url, body) {
    const r = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`POST ${url} failed: ${r.status}`);
    return r.json();
  }

  // -----------------------------
  // Renderers (optional sections)
  // -----------------------------
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

let agreementsSelectedId = null;

function renderAgreementsTiles({ templates, defaultId }) {
  const grid = document.getElementById("agreements-grid");
  if (!grid) return;

  if (!templates?.length) {
    grid.innerHTML = `<div class="muted">No templates yet. Import one to get started.</div>`;
    return;
  }

  agreementsSelectedId = defaultId || null;
  setAgreementsDefaultButtonState();

  grid.innerHTML = templates
    .map((t) => {
      const isDefault = String(t.id) === String(defaultId);
      const isSelected = String(t.id) === String(agreementsSelectedId);

      const subtitle = ""; // intentionally blank (we're hiding version/provider for clean UI)

      return `
        <div class="agreement-tile ${isDefault ? "is-default" : ""} ${isSelected ? "is-selected" : ""}"
             role="button"
             tabindex="0"
             data-id="${t.id}">
      
          <button
            class="tile-preview tile-preview--clickable"
            type="button"
            data-open-pdf="${t.id}"
            aria-label="Open PDF"
          >

            <div class="paper">
              <div class="paper-line w90"></div>
              <div class="paper-line w70"></div>
              <div class="paper-line w85"></div>
              <div class="paper-line w60"></div>
            </div>
            <div class="pdf-chip">OPEN PDF</div>
          </button>
      
          <div class="tile-body">
            <div class="tile-actions">
                ${isDefault ? `<span class="pill-badge pill-badge--on">DEFAULT</span>` : ``}
            </div>
              <div class="tile-name">${escapeHtml(t.name || "Untitled")}</div>
              <div class="tile-meta muted">Updated ${escapeHtml(fmtDate(t.created_at))}</div>
          </div>
        </div>
      `;
    })
    .join("");

  grid.querySelectorAll(".agreement-tile").forEach((btn) => {
    btn.addEventListener("click", () => {
      agreementsSelectedId = btn.getAttribute("data-id");
      grid.querySelectorAll(".agreement-tile").forEach((b) => b.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      setAgreementsDefaultButtonState();
    });
  });

grid.querySelectorAll(".agreement-tile").forEach((tile) => {
  tile.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      tile.click();
    }
  });
});


  
  grid.querySelectorAll("[data-open-pdf]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation(); // IMPORTANT: do not select tile / re-render
      const id = btn.getAttribute("data-open-pdf");
      if (!id) return;
      window.open(`/api/user-contracts/${encodeURIComponent(id)}/pdf`, "_blank", "noopener");
    });
  });
  
}

  async function loadAgreements() {
  const [tplRes, defRes] = await Promise.all([
    apiGet("/api/user-contracts"),
    apiGet("/api/agreements/default"),
  ]);

  const templates = tplRes?.rows || [];
  const defaultId = defRes?.row?.default_user_contract_id || null;


  renderAgreementsTiles({ templates, defaultId });
}


  function renderPlans(plan) {
    const el = $("plan-grid");
    if (!el) return;

    const plans = plan?.available || [
      { id: "starter", name: "Starter", desc: "Lightweight monitoring for small teams." },
      { id: "pro", name: "Pro", desc: "More watched carriers, faster refresh, richer alerts." },
      { id: "team", name: "Team", desc: "Multi-user workflows and shared monitoring." },
    ];

    const current = plan?.current_id;

    el.innerHTML = plans
      .map((p) => {
        const active = p.id === current;
        return `
          <div class="card" style="padding:14px;">
            <div class="card-head">
              <h2 style="font-size:.95rem;">${p.name}</h2>
              ${active ? `<span class="badge">Current</span>` : ``}
            </div>
            <div class="muted" style="margin-top:0;">${p.desc}</div>
            <div style="margin-top:12px;">
              <button class="pill-btn ${active ? "pill-btn-secondary" : ""}" data-select-plan="${p.id}">
                ${active ? "Selected" : "Select"}
              </button>
            </div>
          </div>
        `;
      })
      .join("");
  }

function getSaveButtons() {
  return [
    document.getElementById("btn-save-alert-fields"),
    document.getElementById("btn-save-alert-fields-top"),
  ].filter(Boolean);
}

function setSaveButtonsDisabled(disabled) {
  getSaveButtons().forEach((b) => (b.disabled = !!disabled));
}


// -----------------------------
// Email alert fields (per-user)
// -----------------------------
let emailFieldsOriginal = [];
let emailFieldsCurrent = [];

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function renderEmailAlertFields(fields) {
  const host = document.getElementById("email-alert-fields");
  if (!host) return;

  // group by category
  const groups = new Map();
  for (const f of fields) {
    const cat = f.category || "Other";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(f);
  }

  host.innerHTML = Array.from(groups.entries()).map(([cat, items]) => {
    const inner = items.map((f) => {
      const checked = f.enabled ? "checked" : "";
      const label = f.label || f.field_key;
      return `
        <label class="toggle">
          <input type="checkbox" data-field-key="${f.field_key}" ${checked}>
          <span>${label}</span>
        </label>
      `;
    }).join("");

    return `
      <div class="alert-cat">
        <div class="alert-cat-title">${cat}</div>
        <div class="toggle-grid">
          ${inner}
        </div>
      </div>
    `;
  }).join("");

  // bind changes
  host.querySelectorAll('input[type="checkbox"][data-field-key]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const key = cb.getAttribute("data-field-key");
      const row = emailFieldsCurrent.find((x) => x.field_key === key);
      if (row) row.enabled = cb.checked;
      updateEmailFieldsSaveState();
    });
  });
}

function updateEmailFieldsSaveState() {
  const dirty =
    JSON.stringify(emailFieldsCurrent) !== JSON.stringify(emailFieldsOriginal);

  // enable/disable BOTH buttons
  setSaveButtonsDisabled(!dirty);
}


async function loadEmailAlertFields() {
  // You implement these endpoints on backend
  const data = await apiGet("/api/account/email-alert-fields");
  const fields = data?.fields || [];

  emailFieldsOriginal = clone(fields);
  emailFieldsCurrent  = clone(fields);

  renderEmailAlertFields(emailFieldsCurrent);
  updateEmailFieldsSaveState();
}

async function saveEmailAlertFields() {
  // disable BOTH while saving
  setSaveButtonsDisabled(true);

  // send only changes
  const updates = [];
  const origMap = new Map(emailFieldsOriginal.map((x) => [x.field_key, x.enabled]));
  for (const cur of emailFieldsCurrent) {
    if (origMap.get(cur.field_key) !== cur.enabled) {
      updates.push({ field_key: cur.field_key, enabled: cur.enabled });
    }
  }

  // nothing to save -> keep disabled
  if (!updates.length) {
    updateEmailFieldsSaveState();
    return;
  }

  await apiPost("/api/account/email-alert-fields", { updates });

  emailFieldsOriginal = clone(emailFieldsCurrent);
  updateEmailFieldsSaveState(); // will disable both now (not dirty)
}


function setAgreementsDefaultButtonState() {
  const btn = document.getElementById("btn-set-default");
  if (!btn) return;
  btn.disabled = !agreementsSelectedId;
}


// -----------------------------
// Help & Support
// -----------------------------
const helpContactEmail = $("help-contact-email");
const helpContactPhone = $("help-contact-phone");
const helpSubject = $("help-subject");
const helpMessage = $("help-message");
const helpSend = $("btn-help-send");
const ticketList = $("ticket-list");
const helpErr = $("help-error");
const helpOk = $("help-ok");

function setHelpMsg(type, msg){
  helpErr && (helpErr.style.display = "none");
  helpOk && (helpOk.style.display = "none");

  if (type === "error" && helpErr) {
    helpErr.textContent = msg || "Something went wrong.";
    helpErr.style.display = "block";
  }
  if (type === "ok" && helpOk) {
    helpOk.textContent = msg || "Sent.";
    helpOk.style.display = "block";
  }
}

function updateHelpSendState(){
  const email = (helpContactEmail?.value || "").trim();
  const subj  = (helpSubject?.value || "").trim();
  const msg   = (helpMessage?.value || "").trim();

  const okEmail = email.includes("@") && email.length >= 6;
  helpSend.disabled = !(okEmail && subj.length >= 3 && msg.length >= 10);
}

[helpContactEmail, helpContactPhone, helpSubject, helpMessage].forEach((el) => {
  el?.addEventListener("input", updateHelpSendState);
});

function renderTickets(tickets){
  if (!ticketList) return;

  if (!tickets?.length) {
    ticketList.innerHTML = `<div class="muted">No tickets yet.</div>`;
    return;
  }

  ticketList.innerHTML = tickets.map(t => {
    const id = `#${t.id}`;
    const subj = escapeHtml(t.subject || "—");
    const when = t.created_at ? new Date(t.created_at).toLocaleString() : "";
    const status = escapeHtml(t.status || "open");
    return `
      <div class="ticket-item">
        <div class="ticket-top">
          <div class="ticket-id">${id}</div>
          <div class="ticket-meta">${status}</div>
        </div>
        <div class="ticket-subject">${subj}</div>
        <div class="ticket-meta">${escapeHtml(when)}</div>
      </div>
    `;
  }).join("");
}

// simple escape for innerHTML
function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

async function loadTickets(){
  if (!ticketList) return;
  ticketList.innerHTML = `<div class="muted">Loading…</div>`;

  const r = await fetch("/api/support/tickets", { credentials: "include" });
  if (!r.ok) {
    ticketList.innerHTML = `<div class="muted">Couldn’t load tickets.</div>`;
    return;
  }
  const data = await r.json();
  renderTickets(data.tickets || []);
}

helpSend?.addEventListener("click", async () => {
  const contact_email = (helpContactEmail?.value || "").trim();
  const contact_phone = (helpContactPhone?.value || "").trim();
  const subject = (helpSubject?.value || "").trim();
  const message = (helpMessage?.value || "").trim();

  helpSend.disabled = true;
  setHelpMsg(null, "");

  try {
    const r = await fetch("/api/support/tickets", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_email, contact_phone, subject, message }),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Failed to send.");

    setHelpMsg("ok", `Sent. Ticket #${data.ticket_id}`);
    // clear message only (keep contact info)
    helpSubject.value = "";
    helpMessage.value = "";
    updateHelpSendState();
    await loadTickets();
  } catch (e) {
    console.error(e);
    setHelpMsg("error", e.message || "Could not send.");
    updateHelpSendState();
  }
});


  
  // -----------------------------
  // Main load
  // -----------------------------
  async function loadEverything() {
    // 1) Snapshot
    const me = await apiGet("/api/account/overview");

    if ($("me-name")) $("me-name").textContent = me?.name || me?.user?.name || "—";
    if ($("me-email")) $("me-email").textContent = me?.email || me?.user?.email || "—";
    if ($("me-company")) $("me-company").textContent = me?.company || me?.user?.company || "—";
    if ($("me-plan")) $("me-plan").textContent = me?.plan || me?.user?.plan || "—";
setPlanBadge(me?.plan || me?.user?.plan);
    setPill("me-email_alerts", me?.email_alerts);
    setPill("me-rest_alerts", me?.rest_alerts);
    setPill("me-webhook_alerts", me?.webhook_alerts);

    // Plan badge: keep it simple for now (no “tier logic”)
   // const planBadge = $("plan-badge");
  // if (planBadge) planBadge.textContent = me?.plan || me?.user?.plan || "—";

// Load per-field categories only if the container exists
if (document.getElementById("email-alert-fields")) {
  await loadEmailAlertFields();
}

    
    // 2) Agreements (only if that section exists)
    if (document.getElementById("agreements-grid")) {
      await loadAgreements();
    }

    // 3) API (only if that section exists)
    if ($("api-key-masked")) {
      const api = await apiGet("/api/user/api");
      $("api-key-masked").textContent = api?.masked_key || "—";
    
      const wh = await apiGet("/api/user/webhook");
      const input = $("webhook-url");
      const btn = $("btn-save-webhook");
    
      if (input && btn) {
        input.value = wh?.webhook_url || "";
        WEBHOOK_ORIGINAL = input.value;
        btn.disabled = true;
    
        input.addEventListener("input", () => {
          btn.disabled = input.value.trim() === WEBHOOK_ORIGINAL;
        });
      }
    }

    // 4) Plan grid (only if you kept that section)
    if ($("plan-grid")) {
      const plan = await apiGet("/api/user/plan");
      renderPlans(plan);
    }
  }

getSaveButtons().forEach((btn) => {
  btn.addEventListener("click", () => {
    saveEmailAlertFields().catch(console.error);
  });
});


  
document.getElementById("btn-set-default")?.addEventListener("click", async () => {
  if (!agreementsSelectedId) return;

  try {
    await apiPost("/api/agreements/default", { user_contract_id: agreementsSelectedId });
    await loadAgreements();
  } catch (err) {
    console.error(err);
    alert("Failed to set default agreement.");
  }
});



// -----------------------------
// API buttons
// -----------------------------


$("btn-save-webhook")?.addEventListener("click", async () => {
  const input = $("webhook-url");
  if (!input) return;

  const url = input.value.trim();

  try {
    await apiPost("/api/user/webhook", { webhook_url: url });
    WEBHOOK_ORIGINAL = url;
    $("btn-save-webhook").disabled = true;
    alert("Webhook saved.");
  } catch (e) {
    console.error(e);
    alert("Failed to save webhook URL.");
  }
});


  
$("btn-copy-key")?.addEventListener("click", async () => {
  try {
    if (!API_KEY_FULL) {
      alert("For security, the full key is only shown right after rotation. Click Rotate to generate a new one.");
      return;
    }

    await navigator.clipboard.writeText(API_KEY_FULL);
    $("btn-copy-key").textContent = "Copied";
    setTimeout(() => ($("btn-copy-key").textContent = "Copy"), 900);
  } catch (e) {
    console.error(e);
    alert("Copy failed.");
  }
});

$("btn-rotate-key")?.addEventListener("click", async () => {
  if (!confirm("Rotate API key? This will break anything using the old key.")) return;

  try {
    const r = await apiPost("/api/user/api/rotate", {});
    $("api-key-masked").textContent = r?.masked_key || "—";
    API_KEY_FULL = r?.full_key || null;

    if (API_KEY_FULL) {
      await navigator.clipboard.writeText(API_KEY_FULL);
      $("btn-copy-key").textContent = "Copied";
      setTimeout(() => ($("btn-copy-key").textContent = "Copy"), 900);
    }
  } catch (e) {
    console.error(e);
    alert("Failed to rotate API key.");
  }
});

$("btn-api-docs")?.addEventListener("click", () => {
  window.open("/docs", "_blank", "noopener");
});


  
// -----------------------------
// Change Password Modal
// -----------------------------
const pwModal = $("pw-modal");
const pwClose = $("pw-close");
const pwCancel = $("pw-cancel");
const pwSave = $("pw-save");
const pwErr = $("pw-error");
const pwOk = $("pw-ok");

const pwCurrent = $("pw-current");
const pwNew = $("pw-new");
const pwConfirm = $("pw-confirm");

function openPwModal() {
  if (!pwModal) return;
  pwErr.style.display = "none";
  pwOk.style.display = "none";
  pwErr.textContent = "";
  pwOk.textContent = "";
  pwCurrent.value = "";
  pwNew.value = "";
  pwConfirm.value = "";
  pwSave.disabled = false;

  pwModal.classList.add("is-open");
  pwModal.setAttribute("aria-hidden", "false");
  setTimeout(() => pwCurrent?.focus(), 0);
}

function closePwModal() {
  if (!pwModal) return;
  pwModal.classList.remove("is-open");
  pwModal.setAttribute("aria-hidden", "true");
}

function showPwError(msg) {
  pwOk.style.display = "none";
  pwErr.textContent = msg || "Something went wrong.";
  pwErr.style.display = "block";
}

function showPwOk(msg) {
  pwErr.style.display = "none";
  pwOk.textContent = msg || "Password updated.";
  pwOk.style.display = "block";
}

$("btn-change-password")?.addEventListener("click", openPwModal);

pwClose?.addEventListener("click", closePwModal);
pwCancel?.addEventListener("click", closePwModal);
pwModal?.addEventListener("click", (e) => {
  if (e.target === pwModal) closePwModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && pwModal?.classList.contains("is-open")) closePwModal();
});

pwSave?.addEventListener("click", async () => {
  const currentPassword = pwCurrent.value || "";
  const newPassword = pwNew.value || "";
  const confirm = pwConfirm.value || "";

  if (!currentPassword) return showPwError("Enter your current password.");
  if (newPassword.length < 8) return showPwError("New password must be at least 8 characters.");
  if (newPassword !== confirm) return showPwError("New passwords do not match.");

  pwSave.disabled = true;

  try {
    await apiPost("/api/change-password", { currentPassword, newPassword });
    showPwOk("Password updated.");
    setTimeout(closePwModal, 700);
  } catch (err) {
    showPwError("Could not update password. Check your current password and try again.");
    pwSave.disabled = false;
  }
});

  
  loadEverything().catch((err) => console.error(err));
})();
