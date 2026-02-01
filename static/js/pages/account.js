/* static/js/pages/account.js */
(() => {
  const $ = (id) => document.getElementById(id);

  const railItems = Array.from(document.querySelectorAll(".rail-item"));
  const panels = {
    overview: $("tab-overview"),
    alerts: $("tab-alerts"),
    agreements: $("tab-agreements"),
    api: $("tab-api"),
    plan: $("tab-plan"),
    security: $("tab-security"),
  };

  // state
  let originalSettings = null;
  let currentSettings = null;

  const savebar = $("savebar");
  const saveText = $("savebar-text");

  function setActiveTab(name) {
    railItems.forEach((b) => b.classList.toggle("is-active", b.dataset.tab === name));
    Object.entries(panels).forEach(([k, el]) => {
        if (!el) return;
        el.classList.toggle("is-active", k === name);
      });
  }

  railItems.forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });

  document.querySelectorAll("[data-tab-jump]").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tabJump));
  });

function setPill(id, enabled) {
  const el = document.getElementById(id);
  if (!el) return;

  el.classList.toggle("is-on", enabled === true);
  el.classList.toggle("is-off", enabled === false);
}

// booleans straight from API
setPill("me-email_alerts",   me.email_alerts);
setPill("me-rest_alerts",    me.rest_alerts);
setPill("me-webhook_alerts", me.webhook_alerts);

  
  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function isDirty() {
    return JSON.stringify(currentSettings) !== JSON.stringify(originalSettings);
  }

  function updateSavebar() {
    const dirty = isDirty();
    savebar.classList.toggle("hidden", !dirty);
    saveText.textContent = dirty ? "Unsaved changes" : "";
  }

  function bindSettingsToUI() {
    // Master toggles
    $("alerts-master-toggle").checked = !!currentSettings.enabled;
    $("alerts-enabled").checked = !!currentSettings.enabled;

    $("alerts-frequency").value = currentSettings.frequency || "instant";
    $("alerts-preset").value = currentSettings.preset || "balanced";

    // category toggles
    document.querySelectorAll("[data-cat]").forEach((el) => {
      const key = el.getAttribute("data-cat");
      el.checked = !!currentSettings.categories?.[key];
    });

    // overview pill
    $("alerts-status").textContent = currentSettings.enabled ? "On" : "Off";
  }

  function readUIToSettings() {
    currentSettings.enabled = $("alerts-enabled").checked;
    currentSettings.frequency = $("alerts-frequency").value;
    currentSettings.preset = $("alerts-preset").value;

    currentSettings.categories = currentSettings.categories || {};
    document.querySelectorAll("[data-cat]").forEach((el) => {
      const key = el.getAttribute("data-cat");
      currentSettings.categories[key] = !!el.checked;
    });

    // keep overview toggle synced
    $("alerts-master-toggle").checked = currentSettings.enabled;
    $("alerts-status").textContent = currentSettings.enabled ? "On" : "Off";
  }

  function attachChangeHandlers() {
    const inputs = [
      $("alerts-master-toggle"),
      $("alerts-enabled"),
      $("alerts-frequency"),
      $("alerts-preset"),
      ...Array.from(document.querySelectorAll("[data-cat]")),
    ];

    inputs.forEach((el) => {
      el.addEventListener("change", () => {
        // sync master toggle
        if (el === $("alerts-master-toggle")) {
          $("alerts-enabled").checked = $("alerts-master-toggle").checked;
        }
        if (el === $("alerts-enabled")) {
          $("alerts-master-toggle").checked = $("alerts-enabled").checked;
        }

        readUIToSettings();
        updateSavebar();
      });
    });
  }

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

  async function loadEverything() {
    // 1) me
    const me = await apiGet("/api/account/overview");
    $("me-name").textContent = me?.name || me?.user?.name || "—";
    $("me-email").textContent = me?.email || me?.user?.email || "—";
    $("me-company").textContent = me?.company || me?.user?.company || "—";
    $("me-plan").textContent = me?.plan || me?.user?.plan || "—";
    $("me-email_alerts").textContent = me?.email_alerts || me?.user?.email_alerts || "—";
    $("me-rest_alerts").textContent = me?.rest_alerts || me?.user?.rest_alerts || "—";
    $("me-webhook_alerts").textContent = me?.webhook_alerts || me?.user?.webhook_alerts || "—";

    // 2) alert settings
    const settings = await apiGet("/api/user/alert-settings").catch(() => null);
    const fallback = {
      enabled: false,
      frequency: "instant",
      preset: "balanced",
      categories: { insurance: true, authority: true, safety: true, operations: false },
    };
    
    originalSettings = deepClone(settings || fallback);
    currentSettings  = deepClone(settings || fallback);


    bindSettingsToUI();
    attachChangeHandlers();

    // 3) agreements
    const ag = await apiGet("/api/user/agreements");
    renderAgreements(ag);

    // 4) api
    const api = await apiGet("/api/user/api");
    $("api-key-masked").textContent = api?.masked_key || "—";

    // 5) plan
    const plan = await apiGet("/api/user/plan");
    $("plan-badge").textContent = plan?.name ? plan.name : "—";
    renderPlans(plan);
  }

  function renderAgreements(data) {
    const tbody = $("agreements-tbody");
    const list = data?.agreements || [];
    const defaultId = data?.default_agreement_id;

    const defaultAgreement = list.find((x) => x.id === defaultId);
    $("default-agreement-label").textContent = defaultAgreement ? defaultAgreement.name : "—";

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="4">No agreements found.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((a) => {
      const isDefault = a.id === defaultId;
      return `
        <tr data-id="${a.id}">
          <td>
            ${a.name}
            ${isDefault ? `<span class="badge" style="margin-left:8px;">Default</span>` : ``}
          </td>
          <td>${a.type || "—"}</td>
          <td>${a.updated_at ? new Date(a.updated_at).toLocaleDateString() : "—"}</td>
          <td style="text-align:right;">
            <button class="pill-btn pill-btn-secondary" data-preview="${a.id}">Preview</button>
            <button class="pill-btn" data-make-default="${a.id}">Set default</button>
          </td>
        </tr>
      `;
    }).join("");

    tbody.querySelectorAll("[data-make-default]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-make-default");
        await apiPost("/api/user/agreements/default", { agreement_id: id });
        const ag = await apiGet("/api/user/agreements");
        renderAgreements(ag);
      });
    });

    tbody.querySelectorAll("[data-preview]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-preview");
        window.open(`/agreements/${encodeURIComponent(id)}/preview`, "_blank");
      });
    });
  }

  function renderPlans(plan) {
    const el = $("plan-grid");
    const plans = plan?.available || [
      { id: "starter", name: "Starter", desc: "Lightweight monitoring for small teams." },
      { id: "pro", name: "Pro", desc: "More watched carriers, faster refresh, richer alerts." },
      { id: "team", name: "Team", desc: "Multi-user workflows and shared monitoring." },
    ];

    const current = plan?.current_id;

    el.innerHTML = plans.map((p) => {
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
    }).join("");
  }

  $("btn-reset").addEventListener("click", () => {
    currentSettings = deepClone(originalSettings);
    bindSettingsToUI();
    updateSavebar();
  });

  $("btn-save").addEventListener("click", async () => {
    // save alert settings
    await apiPost("/api/user/alert-settings", currentSettings);
    originalSettings = deepClone(currentSettings);
    updateSavebar();
  });

  // Keep overview + alerts toggles in sync
  $("alerts-master-toggle").addEventListener("change", () => {
    $("alerts-enabled").checked = $("alerts-master-toggle").checked;
  });

  
  // kickoff
  loadEverything().catch((err) => {
    console.error(err);
    // You can add a toast later; keeping simple for now.
  });
})();
