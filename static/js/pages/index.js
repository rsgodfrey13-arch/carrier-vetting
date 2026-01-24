/* static/js/pages/index.js */

(() => {
  // ---------------------------------------------
  // STATE
  // ---------------------------------------------
  let myCarrierDots = new Set();

  let currentPage = 1;
  let pageSize = 25;
  let totalRows = 0;
  let totalPages = 0;

  let sortBy = "carrier";
  let sortDir = "asc";

  // ---------------------------------------------
  // HELPERS
  // ---------------------------------------------
  function $(id) {
    return document.getElementById(id);
  }

  function goToCarrier(dot) {
    if (!dot) return;
    window.location.pathname = "/" + encodeURIComponent(dot);
  }

  // ---------------------------------------------
  // BULK IMPORT MODAL LOADER (FIXED)
  // ---------------------------------------------
  async function loadImportModalAndInitWizard() {
    try {
      if (!document.getElementById("import-modal")) {
        const res = await fetch("/static/partials/import-modal.html");
        const html = await res.text();
        document.body.insertAdjacentHTML("beforeend", html);
      }

      // ✅ ONLY initialize wizard AFTER modal exists
      wireBulkImportWizard();
    } catch (e) {
      console.error("Failed to load import modal", e);
    }
  }

  // ---------------------------------------------
  // TABLE LOAD + RENDER
  // ---------------------------------------------
  async function loadCarriers() {
    try {
      const tbody = $("carrier-table-body");
      if (!tbody) return;

      tbody.innerHTML = "";

      let endpoint = "/api/public-carriers";
      try {
        const me = await fetch("/api/me").then(r => r.json());
        if (me.user) endpoint = "/api/my-carriers";
      } catch {}

      const url = new URL(endpoint, window.location.origin);
      url.searchParams.set("page", currentPage);
      url.searchParams.set("pageSize", pageSize);
      url.searchParams.set("sortBy", sortBy);
      url.searchParams.set("sortDir", sortDir);

      const res = await fetch(url);
      const result = await res.json();
      const data = result.rows || [];

      totalRows = result.total || data.length;
      totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

      if (!data.length) {
        tbody.innerHTML = `<tr><td colspan="10">No carriers found.</td></tr>`;
        renderPagination();
        return;
      }

      data.forEach(c => {
        const tr = document.createElement("tr");
        const dot = c.dot || c.dotnumber || c.id || "";

        tr.innerHTML = `
          <td class="select-cell"><input type="checkbox" class="row-select" data-dot="${dot}"></td>
          <td><a href="/${dot}" class="dot-link">${dot}</a></td>
          <td>${c.mc_number || "-"}</td>
          <td>${c.legalname || c.dbaname || "-"}</td>
          <td>${c.city || ""}${c.state ? ", " + c.state : ""}</td>
          <td>${c.allowedtooperate === "Y" ? "Authorized" : "Not Authorized"}</td>
          <td>${c.commonauthoritystatus || "-"}</td>
          <td>${c.contractauthoritystatus || "-"}</td>
          <td>${c.brokerauthoritystatus || "-"}</td>
          <td>${c.safetyrating || "Not Rated"}</td>
        `;

        tr.addEventListener("click", e => {
          if (!e.target.closest(".select-cell") && e.target.tagName !== "A") {
            goToCarrier(dot);
          }
        });

        tbody.appendChild(tr);
      });

      renderPagination();
    } catch (err) {
      console.error("Error fetching carriers:", err);
    }
  }

  function renderPagination() {
    const container = $("pagination-controls");
    if (!container || totalPages <= 1) return;

    container.innerHTML = "";

    for (let p = 1; p <= totalPages; p++) {
      const btn = document.createElement("button");
      btn.textContent = p;
      btn.className = p === currentPage ? "active" : "";
      btn.onclick = () => {
        currentPage = p;
        loadCarriers();
      };
      container.appendChild(btn);
    }
  }

  // ---------------------------------------------
  // BULK IMPORT WIZARD (UNCHANGED LOGIC)
  // ---------------------------------------------
  function wireBulkImportWizard() {
    const bulkImportBtn = $("bulk-import-btn");
    const importModal = $("import-modal");
    const importNextBtn = $("import-next-btn");

    if (!bulkImportBtn || !importModal || !importNextBtn) return;

    bulkImportBtn.onclick = () => {
      importModal.classList.remove("hidden");
    };
  }

  // ---------------------------------------------
  // BOOT (FIXED)
  // ---------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    loadCarriers();
    loadImportModalAndInitWizard();
  });
})();
