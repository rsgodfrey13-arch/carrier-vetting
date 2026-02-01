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


    
    // 2) Agreements (only if that section exists)
    if ($("agreements-tbody")) {
      const ag = await apiGet("/api/user/agreements");
      renderAgreements(ag);
    }

    // 3) API (only if that section exists)
    if ($("api-key-masked")) {
      const api = await apiGet("/api/user/api");
      $("api-key-masked").textContent = api?.masked_key || "—";
    }

    // 4) Plan grid (only if you kept that section)
    if ($("plan-grid")) {
      const plan = await apiGet("/api/user/plan");
      renderPlans(plan);
    }
  }

  loadEverything().catch((err) => console.error(err));
})();
