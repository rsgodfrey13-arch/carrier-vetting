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

  // These may not exist if you removed that section (that's fine)
  const savebar = $("savebar");
  const saveText = $("savebar-text");

  function setActiveTab(name) {
    railItems.forEach((b) =>
      b.classList.toggle("is-active", b.dataset.tab === name)
    );
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

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function isDirty() {
    // If you removed the save/edit section, this might never be set. Treat as not dirty.
    if (!currentSettings || !originalSettings) return false;
    return JSON.stringify(currentSettings) !== JSON.stringify(originalSettings);
  }

  function updateSavebar() {
    // If savebar is removed from HTML, do nothing (no crash).
    if (!savebar || !saveText) return;
    const dirty = isDirty();
    savebar.classList.toggle("hidden", !dirty);
    saveText.textContent = dirty ? "Unsaved changes" : "";
  }

  function bindSettingsToUI() {
    if (!currentSettings) return;

    // All of these elements might be removed from HTML — guard each one.
    const master = $("alerts-master-toggle");
    const enabled = $("alerts-enabled");
    const freq = $("alerts-frequency");
    const preset = $("alerts-preset");
    const status = $("alerts-status");

    if (master) master.checked = !!currentSettings.enabled;
    if (enabled) enabled.checked = !!currentSettings.enabled;

    if (freq) freq.value = currentSettings.frequency || "instant";
    if (preset) preset.value = currentSettings.preset || "balanced";

    document.querySelectorAll("[data-cat]").forEach((el) => {
      const key = el.getAttribute("data-cat");
      el.checked = !!currentSettings.categories?.[key];
    });

    if (status) status.textContent = currentSettings.enabled ? "On" : "Off";
  }

  function readUIToSettings() {
    if (!currentSettings) return;

    const enabled = $("alerts-enabled");
    const freq = $("alerts-frequency");
    const preset = $("alerts-preset");
    const master = $("alerts-master-toggle");
    const status = $("alerts-status");

    if (enabled) currentSettings.enabled = !!enabled.checked;
    if (freq) currentSettings.frequency = freq.value;
    if (preset) currentSettings.preset = preset.value;

    currentSettings.categories = currentSettings.categories || {};
    document.querySelectorAll("[data-cat]").forEach((el) => {
      const key = el.getAttribute("data-cat");
      currentSettings.categories[key] = !!el.checked;
    });

    // keep overview toggle synced (only if those elements exist)
    if (master) master.checked = !!currentSettings.enabled;
    if (status) status.textContent = currentSettings.enabled ? "On" : "Off";
  }

  function attachChangeHandlers() {
    const master = $("alerts-master-toggle");
    const enabled = $("alerts-enabled");
    const freq = $("alerts-frequency");
    const preset = $("alerts-preset");
    const cats = Array.from(document.querySelectorAll("[data-cat]"));

    // Build list but remove nulls so addEventListener never hits null
    const inputs = [master, enabled, freq, preset, ...cats].filter(Boolean);

    // If you deleted those controls from HTML, there will be nothing to attach — that's fine.
    if (!inputs.length) return;

    inputs.forEach((el) => {
      el.addEventListener("change", () => {
        // sync master toggle if both exist
        if (master && enabled) {
          if (el === master) enabled.checked = master.checked;
          if (el === enabled) master.checked = enabled.checked;
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
    // 1) me (snapshot)
    const me = await apiGet("/api/account/overview");

    const meName = $("me-name");
    const meEmail = $("me-email");
    const meCompany = $("me-company");
    const mePlan = $("me-plan");

    if (meName) meName.textContent = me?.name || me?.user?.name || "—";
    if (meEmail) meEmail.textContent = me?.email || me?.user?.email || "—";
    if (meCompany) meCompany.textContent = me?.company || me?.user?.company || "—";
    if (mePlan) mePlan.textContent = me?.plan || me?.user?.plan || "—";

    setPill("me-email_alerts",   !!me?.email_alerts);
    setPill("me-rest_alerts",    !!me?.rest_alerts);
    setPill("me-webhook_alerts", !!me?.webhook_alerts);

    // plan (simple string only)
    const planText = me?.plan || me?.user?.plan || "—";
    const planBadge = document.getElementById("plan-badge");
    if (planBadge) planBadge.textContent = planText;


    // 2) alert settings (ONLY binds if those elements exist)
    const settings = await apiGet("/api/user/alert-settings").catch(() => null);
    const fallback = {
      enabled: false,
      frequency: "instant",
      preset: "balanced",
      categories: { insurance: true, authority: true, safety: true, operations: false },
    };

    originalSettings = deepClone(settings || fallback);
    currentSettings = deepClone(settings || fallback);

    bindSettingsToUI();
    attachChangeHandlers();

    // 3) agreements (ONLY if table exists)
    const tbody = $("agreements-tbody");
    if (tbody) {
      const ag = await apiGet("/api/user/agreements");
      renderAgreements(ag);
    }

    // 4) api (ONLY if element exists)
    const apiKeyEl = $("api-key-masked");
    if (apiKeyEl) {
      const api = await apiGet("/api/user/api");
      apiKeyEl.textContent = api?.masked_key || "—";
    }

    // 5) plan (ONLY if elements exist)
    const planBadge = $("plan-badge");
    const planGrid = $("plan-grid");
    if (planBadge || planGrid) {
      const plan = await apiGet("/api/user/plan");
      if (planBadge) planBadge.textContent = plan?.name ? plan.name : "—";
      if (planGrid) renderPlans(plan);
    }
  }

  function renderAgreements(data) {
    const tbody = $("agreements-tbody");
    if (!tbody) return;

    const list = data?.agreements || [];
    const defaultId = data?.default_agreement_id;

    const defaultAgreement = list.find((x) => x.id === defaultId);
    const defLabel = $("default-agreement-label");
    if (defLabel) defLabel.textContent = defaultAgreement ? defaultAgreement.name : "—";

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="4">No agreements found.</td></tr>`;
      return;
    }

    tbody.innerHTML = list
      .map((a) => {
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
      })
      .join("");

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

  // These buttons might not exist if you removed the save section — guard them.
  const btnReset = $("btn-reset");
  if (btnReset) {
    btnReset.addEventListener("click", () => {
      currentSettings = deepClone(originalSettings);
      bindSettingsToUI();
      updateSavebar();
    });
  }

  const btnSave = $("btn-save");
  if (btnSave) {
    btnSave.addEventListener("click", async () => {
      await apiPost("/api/user/alert-settings", currentSettings);
      originalSettings = deepClone(currentSettings);
      updateSavebar();
    });
  }

  // Keep overview + alerts toggles in sync (only if both exist)
  const master = $("alerts-master-toggle");
  const enabled = $("alerts-enabled");
  if (master && enabled) {
    master.addEventListener("change", () => {
      enabled.checked = master.checked;
    });
  }

  // kickoff
  loadEverything().catch((err) => {
    console.error(err);
  });
})();
