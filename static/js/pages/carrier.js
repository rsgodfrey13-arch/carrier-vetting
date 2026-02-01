// static/js/pages/carrier.js
(() => {

  function getDotFromPath() {
    // take first path segment only, ignore trailing slash / extra segments
    const seg = window.location.pathname.split("/").filter(Boolean)[0] || "";
    // DOT should be digits only
    const digits = decodeURIComponent(seg).replace(/\D/g, "");
    // strip leading zeros safely (optional)
    const noLeading = digits.replace(/^0+/, "");
    return noLeading || (digits ? "0" : "");
  }

  const CURRENT_DOT = getDotFromPath(); 
  let initButtonsRunning = false;
  let initButtonsRerun = false; // NEW: queue reruns instead of dropping

  
  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent =
      value !== null && value !== undefined && value !== "" ? value : "—";
  }

  function setLink(id, url) {
    const el = document.getElementById(id);
    if (!el) return;

    if (url) {
      el.textContent = "Open";
      el.href = url;
    } else {
      el.textContent = "—";
      el.removeAttribute("href");
    }
  }




  function normalizeRating(r) {
    const val = (r || "").toString().trim().toUpperCase();
    if (!val) return "Not Rated";
    if (val === "C") return "Conditional";
    if (val === "S") return "Satisfactory";
    if (val === "U") return "Unsatisfactory";
    return "Not Rated";
  }

  function authorityText(code) {
    const v = (code || "").toString().trim().toUpperCase();
    if (v === "A") return "Active";
    if (v === "I") return "Interstate";
    return "—";
  }

// ----------------------------
// SEND CONTRACT MODAL HELPERS
// ----------------------------
function showSendContractModal() {
  const el = document.getElementById("send-contract-modal");
  if (el) el.hidden = false;
  document.body.style.overflow = "hidden";
}

function hideSendContractModal() {
  const el = document.getElementById("send-contract-modal");
  if (el) el.hidden = true;
  document.body.style.overflow = "";
}


  // ----------------------------
  // EMAIL ALERTS MODAL HELPERS
  // ----------------------------
  function showEmailModal() {
    const el = document.getElementById("email-alerts-modal");
    if (el) el.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function hideEmailModal() {
    const el = document.getElementById("email-alerts-modal");
    if (el) el.hidden = true;
    document.body.style.overflow = "";
  }

function setEmailAlertPill(enabled) {
  const pill = document.getElementById("btn-email-alerts");
  if (!pill) return;

  // ✅ If the iOS switch exists (your real UI), update it
  const ios = pill.querySelector(".ios-switch");
  if (ios) {
    ios.classList.toggle("on", enabled === true);
    ios.classList.toggle("off", enabled === false);

    // optional: unknown state (if you ever use it)
    ios.classList.toggle("unknown", enabled == null);

    // store state if you want for CSS hooks
    pill.dataset.enabled = enabled === true ? "on" : enabled === false ? "off" : "unknown";
    return;
  }

  // -------- fallback (only if you ever render a different pill elsewhere) --------
  pill.dataset.enabled = enabled === true ? "on" : enabled === false ? "off" : "unknown";
}



  
  function wireEmailModalOnce() {
  if (window.__emailModalWired) return;
  window.__emailModalWired = true;

  document.getElementById("email-alerts-close")?.addEventListener("click", hideEmailModal);
  document.getElementById("email-alerts-cancel")?.addEventListener("click", hideEmailModal);

  document.getElementById("email-alerts-save")?.addEventListener("click", async () => {
  const dot = CURRENT_DOT;
  const enabled = !!document.getElementById("email-alerts-enabled")?.checked;     
    
      // pull recipients from state (chips)
      const recipients = Array.isArray(EMAIL_ALERTS_STATE?.recipients)
        ? EMAIL_ALERTS_STATE.recipients
        : [];
      
      const res = await fetch(`/api/my-carriers/${encodeURIComponent(dot)}/alerts/email`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, recipients })
      });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(body.error || "Failed to save email alerts.");
    return;
  }

  // update pill text immediately
  setEmailAlertPill(enabled);

  hideEmailModal();
});


  document.getElementById("email-alerts-modal")?.addEventListener("click", (e) => {
    if (e.target && e.target.id === "email-alerts-modal") hideEmailModal();
  });
}

// ----- Email Alerts modal state (chips) -----
let EMAIL_ALERTS_STATE = {
  dot: null,
  enabled: false,
  recipients: [] // normalized lowercase
};

function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function renderEmailChips() {
  const wrap = document.getElementById("email-alerts-chips");
  if (!wrap) return;

  wrap.innerHTML = "";

  if (!EMAIL_ALERTS_STATE.recipients.length) {
    const empty = document.createElement("div");
    empty.className = "cs-hint";
    empty.textContent = "No recipients yet. Add one below.";
    wrap.appendChild(empty);
    return;
  }

  EMAIL_ALERTS_STATE.recipients.forEach((email) => {
    const chip = document.createElement("span");
    chip.className = "cs-chip";

    const label = document.createElement("span");
    label.textContent = email;

    const x = document.createElement("button");
    x.type = "button";
    x.className = "cs-chip-x";
    x.textContent = "×";
    x.addEventListener("click", () => {
      EMAIL_ALERTS_STATE.recipients = EMAIL_ALERTS_STATE.recipients.filter(e => e !== email);
      renderEmailChips();
    });

    chip.appendChild(label);
    chip.appendChild(x);
    wrap.appendChild(chip);
  });
}

function bindEmailAlertsUIOnce() {
  if (window.__emailRecipientsWired) return;
  window.__emailRecipientsWired = true;

  const enabledEl = document.getElementById("email-alerts-enabled");
  const inputEl = document.getElementById("email-alerts-input");
  const addBtn = document.getElementById("email-alerts-add");

  enabledEl?.addEventListener("change", () => {
    EMAIL_ALERTS_STATE.enabled = !!enabledEl.checked;
  });

  function addFromInput() {
    const raw = normalizeEmail(inputEl?.value);
    if (!raw) return;

    if (!isValidEmail(raw)) {
      alert("Please enter a valid email address.");
      inputEl?.focus();
      return;
    }

    if (!EMAIL_ALERTS_STATE.recipients.includes(raw)) {
      EMAIL_ALERTS_STATE.recipients.push(raw);
      EMAIL_ALERTS_STATE.recipients.sort();
      renderEmailChips();
    }

    if (inputEl) inputEl.value = "";
    inputEl?.focus();
  }

  addBtn?.addEventListener("click", addFromInput);

  inputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addFromInput();
    }
  });
}

async function openEmailAlertsModal(dot) {
  bindEmailAlertsUIOnce();

  EMAIL_ALERTS_STATE = {
    dot: String(dot || "").trim(),
    enabled: false,
    recipients: []
  };

  let data = null;
  try {
    const res = await fetch(`/api/my-carriers/${encodeURIComponent(dot)}/alerts/email`);
    if (res.ok) data = await res.json();
  } catch {}

  const enabledEl = document.getElementById("email-alerts-enabled");

  EMAIL_ALERTS_STATE.enabled = !!data?.enabled;
  if (enabledEl) enabledEl.checked = EMAIL_ALERTS_STATE.enabled;

  const defaultEmail = normalizeEmail(data?.defaultEmail);
  const extras = Array.isArray(data?.recipients) ? data.recipients.map(normalizeEmail) : [];

  EMAIL_ALERTS_STATE.recipients = [...new Set(
    []
      .concat(defaultEmail ? [defaultEmail] : [])
      .concat(extras)
      .filter(Boolean)
  )];

  renderEmailChips();
  showEmailModal();
}


let SEND_CONTRACT_STATE = {
  dot: null,
  defaultEmail: "",      // locked
  recipients: [],        // extras (removable)
  user_contract_id: ""   // required by backend
};

function renderSendContractDefaultChip() {
  const wrap = document.getElementById("send-contract-default-chip");
  if (!wrap) return;

  wrap.innerHTML = "";

  const email = normalizeEmail(SEND_CONTRACT_STATE.defaultEmail);
  if (!email) {
    const empty = document.createElement("div");
    empty.className = "cs-hint";
    empty.textContent = "No FMCSA contact email found for this carrier.";
    wrap.appendChild(empty);
    return;
  }

  const chip = document.createElement("span");
  chip.className = "cs-chip";

  const label = document.createElement("span");
  label.textContent = email;

  // locked: no X
  chip.appendChild(label);
  wrap.appendChild(chip);
}

function renderSendContractChips() {
  const wrap = document.getElementById("send-contract-chips");
  if (!wrap) return;

  wrap.innerHTML = "";

  if (!SEND_CONTRACT_STATE.recipients.length) {
    const empty = document.createElement("div");
    empty.className = "cs-hint";
    empty.textContent = "No additional recipients yet. Add one below.";
    wrap.appendChild(empty);
    return;
  }

  SEND_CONTRACT_STATE.recipients.forEach((email) => {
    const chip = document.createElement("span");
    chip.className = "cs-chip";

    const label = document.createElement("span");
    label.textContent = email;

    const x = document.createElement("button");
    x.type = "button";
    x.className = "cs-chip-x";
    x.textContent = "×";
    x.addEventListener("click", () => {
      SEND_CONTRACT_STATE.recipients = SEND_CONTRACT_STATE.recipients.filter(e => e !== email);
      renderSendContractChips();
    });

    chip.appendChild(label);
    chip.appendChild(x);
    wrap.appendChild(chip);
  });
}

function wireSendContractModalOnce() {
  if (window.__sendContractModalWired) return;
  window.__sendContractModalWired = true;

  document.getElementById("send-contract-close")?.addEventListener("click", hideSendContractModal);
  document.getElementById("send-contract-cancel")?.addEventListener("click", hideSendContractModal);

  document.getElementById("send-contract-modal")?.addEventListener("click", (e) => {
    if (e.target && e.target.id === "send-contract-modal") hideSendContractModal();
  });

  // Add recipient behavior
  const inputEl = document.getElementById("send-contract-input");
  const addBtn = document.getElementById("send-contract-add");

  function addFromInput() {
    const raw = normalizeEmail(inputEl?.value);
    if (!raw) return;

    if (!isValidEmail(raw)) {
      alert("Please enter a valid email address.");
      inputEl?.focus();
      return;
    }

    // Prevent duplicates and prevent adding the locked default as an "extra"
    const def = normalizeEmail(SEND_CONTRACT_STATE.defaultEmail);
    if (raw === def) {
      if (inputEl) inputEl.value = "";
      return;
    }

    if (!SEND_CONTRACT_STATE.recipients.includes(raw)) {
      SEND_CONTRACT_STATE.recipients.push(raw);
      SEND_CONTRACT_STATE.recipients.sort();
      renderSendContractChips();
    }

    if (inputEl) inputEl.value = "";
    inputEl?.focus();
  }

  addBtn?.addEventListener("click", addFromInput);
  inputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addFromInput();
    }
  });

  // SEND button
  document.getElementById("send-contract-send")?.addEventListener("click", async () => {
    const dot = SEND_CONTRACT_STATE.dot;
    const templateId = SEND_CONTRACT_STATE.user_contract_id;
    const defaultEmail = normalizeEmail(SEND_CONTRACT_STATE.defaultEmail);

    if (!dot) return alert("Missing DOT.");
    if (!templateId) return alert("Please select a contract template.");
    if (!defaultEmail) return alert("No FMCSA contact email found for this carrier.");

    // backend expects email_to (string). We'll send comma-separated list.
    const allRecipients = [defaultEmail].concat(SEND_CONTRACT_STATE.recipients || []);
    const email_to = allRecipients.join(", ");

    const res = await fetch(`/api/contracts/send/${encodeURIComponent(dot)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_contract_id: templateId,
        email_to
      })
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(body.error || "Failed to send contract.");
      return;
    }

    hideSendContractModal();
    alert("Contract sent.");
  });
}

async function openSendContractModal(dot, carrierObj) {
  // ensure modal is wired
  wireSendContractModalOnce();

  // ✅ For now: only use carriers.email_address
// Later you can expand this to FMCSA contact fields if you add them.
const guessedDefault = carrierObj?.email_address || "";

// --- FUTURE (optional) --- FUUU TURREE FUUUU TURRREEE
// If you later add FMCSA fields or parse from FMCSA API, you can do:
// const guessedDefault =
//   carrierObj?.email_address ||
//   carrierObj?.fmcsa_email ||
//   carrierObj?.fmcsa_contact_email ||
//   carrierObj?.contact_email ||
//   "";

  SEND_CONTRACT_STATE = {
    dot: String(dot || "").trim(),
    defaultEmail: guessedDefault,
    recipients: [],
    user_contract_id: ""
  };

  // Load templates
  const sel = document.getElementById("send-contract-template");
  if (sel) {
    sel.innerHTML = `<option value="">Loading…</option>`;
  }

  try {
    const r = await fetch("/api/user-contracts");
    const data = r.ok ? await r.json() : null;
    const rows = Array.isArray(data?.rows) ? data.rows : [];

    if (!sel) return;

    if (!rows.length) {
      sel.innerHTML = `<option value="">No templates found</option>`;
      SEND_CONTRACT_STATE.user_contract_id = "";
    } else {
      sel.innerHTML = `<option value="">Select a template…</option>` + rows.map((t) => {
        const label = `${t.name || "Contract"}${t.version ? " v" + t.version : ""}`;
        return `<option value="${t.id}">${label}</option>`;
      }).join("");

      // default to most recent template (first row based on your ORDER BY created_at DESC)
      sel.value = rows[0].id;
      SEND_CONTRACT_STATE.user_contract_id = rows[0].id;
    }

    sel.onchange = () => {
      SEND_CONTRACT_STATE.user_contract_id = sel.value || "";
    };

  } catch (e) {
    if (sel) sel.innerHTML = `<option value="">Failed to load templates</option>`;
  }

  renderSendContractDefaultChip();
  renderSendContractChips();
  showSendContractModal();
}
  

  // Load Carrier Stuff

  async function loadCarrier() {
    const dot = CURRENT_DOT;
    if (!dot) return;

    try {
      const res = await fetch("/api/carriers/" + encodeURIComponent(dot));

      if (!res.ok) {
        console.error("Carrier fetch failed:", res.status, await res.text());
        const nameEl = document.getElementById("carrier-name");
        const dotEl = document.getElementById("carrier-dot");
        if (nameEl) nameEl.textContent = "Carrier not found";
        if (dotEl) dotEl.textContent = dot;
        return;
      }

const data = await res.json();

// support both old and new response shapes
const c = data && data.carrier ? data.carrier : data;
window.__carrierProfile = c;

      
// if backend returned stale data, re-fetch once after background refresh
if (data && data.source === "cache_stale") {
  const key = `carrier_refetch_${dot}`;
  if (!window[key]) {
    window[key] = true;
    setTimeout(() => loadCarrier(), 1300);
  }
}


      // Header
      const name = (c.legalname || c.dbaname || `Carrier ${c.dotnumber || ""}`).trim();
      setText("carrier-name", name);
      setText("carrier-dot", c.dotnumber);
      setText("carrier-mc", c.mc_number);
      setText("carrier-ein", c.ein);

      const addr = [c.phystreet].filter(Boolean).join(", ");
      setText("carrier-address", addr);

      const loc = [c.phycity, c.phystate, c.phycountry].filter(Boolean).join(", ");
      setText("carrier-location", loc);

      setText("carrier-zip", c.phyzipcode);

      // Status pills
      const statusText =
        c.statuscode === "A" ? "Active" :
        c.statuscode === "I" ? "Inactive" :
        "None";

      const allowedText =
        (c.allowedtooperate || "").toString().toUpperCase() === "Y"
          ? "Authorized"
          : "Not Authorized";

      const commonText = authorityText(c.commonauthoritystatus);
      const contractText = authorityText(c.contractauthoritystatus);
      const brokerText = authorityText(c.brokerauthoritystatus);

      const safetyRatingText = normalizeRating(c.safetyrating);

      // Body: replace codes with friendly values
      setText("field-commonauthoritystatus", commonText);
      setText("field-contractauthoritystatus", contractText);
      setText("field-brokerauthoritystatus", brokerText);
      setText("field-safetyrating", safetyRatingText);

      // Pill labels
      const statusEl = document.getElementById("carrier-status");
      const allowedEl = document.getElementById("carrier-allowed");
      const commonEl = document.getElementById("carrier-commonauthoritystatus");
      const contractEl = document.getElementById("carrier-contractauthoritystatus");
      const brokerEl = document.getElementById("carrier-brokerauthoritystatus");
      const safetyEl = document.getElementById("carrier-safetyrating");

      if (statusEl) statusEl.textContent = `STATUS: ${statusText}`;
      if (allowedEl) allowedEl.textContent = `OPERATING STATUS: ${allowedText}`;
      if (commonEl) commonEl.textContent = `COMMON AUTHORITY: ${commonText}`;
      if (contractEl) contractEl.textContent = `CONTRACT AUTHORITY: ${contractText}`;
      if (brokerEl) brokerEl.textContent = `BROKER AUTHORITY: ${brokerText}`;
      if (safetyEl) safetyEl.textContent = `Safety Rating: ${safetyRatingText}`;

      // Pill colors
      if (statusEl) {
        statusEl.classList.add(
          (c.statuscode || "").toString().toUpperCase() === "A" ? "pill-ok" : "pill-warn"
        );
      }

      if (allowedEl) {
        allowedEl.classList.add(
          (c.allowedtooperate || "").toString().toUpperCase() === "Y" ? "pill-ok" : "pill-warn"
        );
      }

      const authPill = (el, raw) => {
        if (!el) return;
        const v = (raw || "").toString().toUpperCase();
        if (v === "A") el.classList.add("pill-ok");
        else if (v === "I") el.classList.add("pill-purp");
      };

      authPill(commonEl, c.commonauthoritystatus);
      authPill(contractEl, c.contractauthoritystatus);
      authPill(brokerEl, c.brokerauthoritystatus);

      // Header meta
      setText("carrier-legalname", c.legalname);
      setText("carrier-dbaname", c.dbaname);
      setText("field-snapshotdate", c.snapshotdate);
      setText("field-issscore", c.issscore);
      setText("field-mcs150outdated", c.mcs150outdated);

      // Basics & meta
      setText("field-retrieval_date_formatted", c.retrieval_date_formatted);
      setText("field-statuscode", c.statuscode);
      setText("field-reviewdate", c.reviewdate);
      setText("field-reviewtype", c.reviewtype);
      setText("field-safetyratingdate", c.safetyratingdate);
      setText("field-safetyreviewdate", c.safetyreviewdate);
      setText("field-safetyreviewtype", c.safetyreviewtype);
      setText("field-oosdate", c.oosdate);
      setText("field-oosratenationalaverageyear", c.oosratenationalaverageyear);

      // Operations & authority (raw details)
      setText("field-carrieroperation_carrieroperationcode", c.carrieroperation_carrieroperationcode);
      setText("field-carrieroperation_carrieroperationdesc", c.carrieroperation_carrieroperationdesc);
      setText("field-censustypeid_censustype", c.censustypeid_censustype);
      setText("field-censustypeid_censustypedesc", c.censustypeid_censustypedesc);
      setText("field-censustypeid_censustypeid", c.censustypeid_censustypeid);
      setText("field-ispassengercarrier", c.ispassengercarrier);

      // Insurance & financial
      setText("field-bipdinsuranceonfile", c.bipdinsuranceonfile);
      setText("field-bipdinsurancerequired", c.bipdinsurancerequired);
      setText("field-bipdrequiredamount", c.bipdrequiredamount);
      setText("field-bondinsuranceonfile", c.bondinsuranceonfile);
      setText("field-bondinsurancerequired", c.bondinsurancerequired);
      setText("field-cargoinsuranceonfile", c.cargoinsuranceonfile);
      setText("field-cargoinsurancerequired", c.cargoinsurancerequired);
      setText("field-allowedtooperate", c.allowedtooperate);
      setText("field-ein", c.ein);

      // Crashes
      setText("field-crashtotal", c.crashtotal);
      setText("field-fatalcrash", c.fatalcrash);
      setText("field-injcrash", c.injcrash);
      setText("field-towawaycrash", c.towawaycrash);

      // Inspections & OOS
      setText("field-driverinsp", c.driverinsp);
      setText("field-driveroosinsp", c.driveroosinsp);
      setText("field-driveroosrate", c.driveroosrate);
      setText("field-driveroosratenationalaverage", c.driveroosratenationalaverage);

      setText("field-hazmatinsp", c.hazmatinsp);
      setText("field-hazmatoosinsp", c.hazmatoosinsp);
      setText("field-hazmatoosrate", c.hazmatoosrate);
      setText("field-hazmatoosratenationalaverage", c.hazmatoosratenationalaverage);

      setText("field-vehicleinsp", c.vehicleinsp);
      setText("field-vehicleoosinsp", c.vehicleoosinsp);
      setText("field-vehicleoosrate", c.vehicleoosrate);
      setText("field-vehicleoosratenationalaverage", c.vehicleoosratenationalaverage);

      setText("field-totaldrivers", c.totaldrivers);
      setText("field-totalpowerunits", c.totalpowerunits);

      // Counts & flags (dup view)
      setText("field-statuscode-dup", c.statuscode);
      setText("field-mcs150outdated-dup", c.mcs150outdated);
      setText("field-snapshotdate-dup", c.snapshotdate);

      // FMCSA links
      setLink("field-link_basics", c.link_basics);
      setLink("field-link_cargo_carried", c.link_cargo_carried);
      setLink("field-link_operation_classification", c.link_operation_classification);
      setLink("field-link_docket_numbers", c.link_docket_numbers);
      setLink("field-link_active_for_hire", c.link_active_for_hire);
      setLink("field-link_self", c.link_self);

      // Cargo carried
      const cargoListEl = document.getElementById("cargo-list");
      if (cargoListEl) {
        if (Array.isArray(c.cargo_carried) && c.cargo_carried.length > 0) {
          cargoListEl.innerHTML = "";
          c.cargo_carried.forEach((desc) => {
            if (!desc) return;
            const li = document.createElement("li");
            li.textContent = desc;
            cargoListEl.appendChild(li);
          });
        } else {
          cargoListEl.innerHTML = "<li>—</li>";
        }
      }

      // Buttons
      await initCarrierButtons(dot);
    } catch (err) {
      console.error("Error fetching carrier:", err);
      const nameEl = document.getElementById("carrier-name");
      if (nameEl) nameEl.textContent = "Error loading carrier";
    }
  }

  async function initCarrierButtons(dot) {
    if (initButtonsRunning) {
      initButtonsRerun = true;   // NEW
      return;
    }
    initButtonsRunning = true;
  
    try {
      const addBtn = document.getElementById("btn-add-carrier");
      const removeBtn = document.getElementById("btn-remove-carrier");
      const emailBtn = document.getElementById("btn-email-alerts"); 
      const contractBtn = document.getElementById("btn-send-contract"); 
  
      if (!addBtn || !removeBtn) return;

  function wireEmailClick(dot) {
  if (!emailBtn) return;
  emailBtn.onclick = () => openEmailAlertsModal(dot);
}

function wireContractClick(dot) {
  if (!contractBtn) return;
  contractBtn.onclick = () => openSendContractModal(dot, window.__carrierProfile || null);
}

    function setState({ isSaved, isLoggedIn }) {
      // NOT LOGGED IN
      if (!isLoggedIn) {
        addBtn.textContent = "Login to Add";
        addBtn.classList.remove("added");
        addBtn.classList.add("pill-disabled");
    
        removeBtn.classList.add("pill-disabled");
        removeBtn.classList.remove("active");
    
        if (emailBtn) {
          emailBtn.classList.add("pill-disabled");
          setEmailAlertPill(null);
        }
        
        if (contractBtn) {
          contractBtn.classList.add("pill-disabled");
        }

    
        return;
      }
    
      // LOGGED IN + SAVED
      if (isSaved) {
        addBtn.textContent = "Added";
        addBtn.classList.add("added", "pill-disabled");
    
        removeBtn.textContent = "Remove Carrier";
        removeBtn.classList.remove("pill-disabled");
        removeBtn.classList.add("active");
    
        if (emailBtn) {
          emailBtn.classList.remove("pill-disabled");
        }

        if (contractBtn) {
          contractBtn.classList.remove("pill-disabled");
        }
    
      // LOGGED IN BUT NOT SAVED
      } else {
        addBtn.textContent = "+ Add Carrier";
        addBtn.classList.remove("added", "pill-disabled");
    
        removeBtn.textContent = "Remove Carrier";
        removeBtn.classList.add("pill-disabled");
        removeBtn.classList.remove("active");
    
        if (emailBtn) {
          emailBtn.classList.add("pill-disabled");
          setEmailAlertPill(null);
        }

          if (contractBtn) {
          contractBtn.classList.add("pill-disabled");
        }

      }
    }


    // logged in?
    let loggedIn = false;
    try {
      const meRes = await fetch("/api/me");
      const meData = await meRes.json();
      loggedIn = !!meData.user;
    } catch (err) {
      console.error("auth check failed", err);
    }

    if (!loggedIn) {
      setState({ isSaved: false, isLoggedIn: false });
      addBtn.onclick = () => (window.location.href = "/login.html");
      if (emailBtn) emailBtn.onclick = () => (window.location.href = "/login.html");
      if (contractBtn) contractBtn.onclick = () => (window.location.href = "/login.html");
      return;
    }


    // saved?
    let isSaved = false;
    try {
      const checkRes = await fetch(`/api/my-carriers/${encodeURIComponent(dot)}`);
    
      if (checkRes.ok) {
        const checkData = await checkRes.json().catch(() => ({}));
    
      isSaved = checkData.saved === true || checkData.isSaved === true;

    
      } else if (checkRes.status === 404) {
        isSaved = false;
      } else {
        console.warn("saved check non-200:", checkRes.status);
      }
    } catch (err) {
      console.error("check saved failed", err);
    }


    setState({ isSaved, isLoggedIn: true });
    // If saved, load current email alerts state and display it in the pill
    if (emailBtn && isSaved) {
      try {
        const r = await fetch(`/api/my-carriers/${encodeURIComponent(dot)}/alerts/email`);
        if (r.ok) {
          const s = await r.json();

          console.log("ALERTS GET:", s); // 👈 ADD THIS LINE
          
          setEmailAlertPill(!!s.enabled);   
          
        } else {
          
          setEmailAlertPill(null);
        }
      } catch {
        setEmailAlertPill(null);
      }
    }

      // STEP 4.7 — wire email pill click
      if (isSaved) wireEmailClick(dot);
      if (isSaved) wireContractClick(dot);
             
      addBtn.onclick = async () => {
        if (addBtn.classList.contains("pill-disabled")) return;
      
        try {
          const res = await fetch("/api/my-carriers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dot }),
          });
      
          const body = await res.json().catch(() => ({}));
      
          if (res.status === 401) {
            window.location.href = "/login.html";
            return;
          }
      
          if (res.ok && body.ok) {
            // update UI immediately
            setState({ isSaved: true, isLoggedIn: true });
          
            if (emailBtn) {
              emailBtn.classList.remove("pill-disabled");
              wireEmailClick(dot);
          
              // fetch alert state after add
              try {
                const r = await fetch(`/api/my-carriers/${encodeURIComponent(dot)}/alerts/email`);
                if (r.ok) {
                  const s = await r.json();
                  setEmailAlertPill(!!s.enabled);   // ✅ THIS is the line you were missing
                } else {
                  setEmailAlertPill(null);
                }
              } catch {
                  setEmailAlertPill(null);
              }
            }

            if (contractBtn) {
              contractBtn.classList.remove("pill-disabled");
              wireContractClick(dot);
            }         
            return;
          }

      
          alert(body.error || "Failed to add carrier.");
        } catch (err) {
          console.error("add carrier failed", err);
          alert("Network error adding carrier.");
        }
      };


    removeBtn.onclick = async () => {
      if (removeBtn.classList.contains("pill-disabled")) return;

      try {
        const res = await fetch(`/api/my-carriers/${encodeURIComponent(dot)}`, {
          method: "DELETE",
        });

        const body = await res.json().catch(() => ({}));

        if (res.status === 401) {
          window.location.href = "/login.html";
          return;
        }

        if (res.ok && body.ok) {
          // update UI immediately (trust the delete)
          setState({ isSaved: false, isLoggedIn: true });
        
          // reset email pill
          if (emailBtn) {
            emailBtn.classList.add("pill-disabled");
            setEmailAlertPill(null);
          }

          if (contractBtn) {
            contractBtn.classList.add("pill-disabled");
          }
        
          // OPTIONAL: confirm backend truth after a short delay
          setTimeout(() => initCarrierButtons(dot), 300);
        
          return; // IMPORTANT: stop here so nothing else runs
        }

 else {
          alert(body.error || "Failed to remove carrier.");
        }
      } catch (err) {
        console.error("remove carrier failed", err);
        alert("Network error removing carrier.");
      }
    };
  } finally {
    initButtonsRunning = false;

    // If someone tried to run again while we were busy, run once more.
    if (initButtonsRerun) {
      initButtonsRerun = false;
      setTimeout(() => initCarrierButtons(dot), 0);
    }
  }
}

  // Copy button handler (kept global for whole page)
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".copy-btn");
    if (!btn) return;

    const targetId = btn.dataset.target;
    const el = document.getElementById(targetId);
    if (!el) return;

    const text = (el.textContent || "").trim();
    if (!text || text === "—") return;

    try {
      await navigator.clipboard.writeText(text);
      const prev = btn.getAttribute("data-tip") || "Copy";
      btn.setAttribute("data-tip", "Copied!");
      setTimeout(() => btn.setAttribute("data-tip", prev), 900);
    } catch {
      // ignore
    }
  });


  // Run ONCE
document.addEventListener("DOMContentLoaded", () => {
  wireEmailModalOnce();
  wireSendContractModalOnce(); 
  loadCarrier();
});

})();
