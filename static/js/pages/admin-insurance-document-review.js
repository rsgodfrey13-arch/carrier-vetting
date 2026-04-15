(() => {
  const NORMALIZED_COVERAGE_TYPES = [
    "AUTO_LIABILITY",
    "CARGO",
    "GENERAL_LIABILITY",
    "UMBRELLA_LIABILITY",
    "WORKERS_COMP",
    "ERRORS_OMISSIONS",
    "CONTINGENT_AUTO_LIABILITY",
  ];

  const state = {
    activeTab: "document-review",
    loading: {
      "document-review": false,
      normalization: false,
    },
    documentReview: {
      rows: [],
      expandedExceptionId: null,
      loaded: false,
    },
    normalization: {
      rows: [],
      expandedExceptionId: null,
      loaded: false,
    },
  };

  const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
  const tabSections = Array.from(document.querySelectorAll(".tab-section"));
  const refreshBtn = document.getElementById("refresh-btn");
  const statusBanner = document.getElementById("status-banner");

  const docQueueBody = document.getElementById("doc-queue-body");
  const docEmptyState = document.getElementById("doc-empty-state");

  const normQueueBody = document.getElementById("norm-queue-body");
  const normEmptyState = document.getElementById("norm-empty-state");

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  function showStatus(message, type = "error") {
    statusBanner.hidden = false;
    statusBanner.classList.toggle("is-error", type === "error");
    statusBanner.classList.toggle("is-success", type === "success");
    statusBanner.textContent = message;
  }

  function clearStatus() {
    statusBanner.hidden = true;
    statusBanner.classList.remove("is-error", "is-success");
    statusBanner.textContent = "";
  }

  async function apiGet(url) {
    const response = await fetch(url, { credentials: "include" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `Request failed: ${response.status}`);
    }
    return payload;
  }

  async function apiPost(url, body) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `Request failed: ${response.status}`);
    }
    return payload;
  }

  function formatDate(value) {
    if (!value) return "—";
    return new Date(value).toLocaleString();
  }

  function renderTabs() {
    tabButtons.forEach((btn) => {
      const tab = btn.getAttribute("data-tab");
      const active = tab === state.activeTab;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });

    tabSections.forEach((section) => {
      section.hidden = section.getAttribute("data-tab-section") !== state.activeTab;
    });
  }

  function docResolveFormHtml(row) {
    return `
      <div class="resolve-panel">
        <form class="doc-resolve-form" data-exception-id="${row.exception_id}">
          <div class="form-grid">
            <div>
              <label>Coverage Type</label>
              <input name="coverage_type" type="text" required />
            </div>
            <div>
              <label>Coverage Type Raw</label>
              <input name="coverage_type_raw" type="text" required />
            </div>
            <div>
              <label>Insurer Letter</label>
              <input name="insurer_letter" type="text" maxlength="2" />
            </div>
            <div>
              <label>Insurer Name</label>
              <input name="insurer_name" type="text" required />
            </div>
            <div>
              <label>Policy Number</label>
              <input name="policy_number" type="text" required />
            </div>
            <div>
              <label>Effective Date</label>
              <input name="effective_date" type="date" required />
            </div>
            <div>
              <label>Expiration Date</label>
              <input name="expiration_date" type="date" required />
            </div>
            <div>
              <label>Limit Label</label>
              <input name="limit_label" type="text" required />
            </div>
            <div>
              <label>Currency</label>
              <select name="currency" required>
                <option value="USD" selected>USD</option>
              </select>
            </div>
            <div>
              <label>Amount</label>
              <input name="amount" type="number" min="0" step="0.01" required />
            </div>
          </div>
          <div class="panel-actions">
            <button class="btn-inline" type="submit">Save Coverage</button>
            <button class="btn-inline" type="button" data-doc-close-resolve="${row.exception_id}">Cancel</button>
          </div>
        </form>
      </div>
    `;
  }

  function normResolveFormHtml(row) {
    const coverageOptions = NORMALIZED_COVERAGE_TYPES.map((v) => `<option value="${v}">${v}</option>`).join("");

    return `
      <div class="resolve-panel">
        <form class="norm-resolve-form" data-exception-id="${row.exception_id}">
          <div class="form-grid">
            <div>
              <label>Coverage Type</label>
              <select name="normalized_coverage_type" required>${coverageOptions}</select>
            </div>
            <div>
              <label>Amount</label>
              <input name="selected_limit_amount" type="number" min="0" step="0.01" required />
            </div>
          </div>
          <div class="panel-actions">
            <button class="btn-inline" type="submit">Resolve</button>
            <button class="btn-inline" type="button" data-norm-close-resolve="${row.exception_id}">Cancel</button>
          </div>
        </form>
      </div>
    `;
  }

  function renderDocumentReviewRows() {
    docQueueBody.innerHTML = "";

    if (!state.documentReview.rows.length) {
      docEmptyState.hidden = false;
      return;
    }

    docEmptyState.hidden = true;

    for (const row of state.documentReview.rows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(row.dot_number)}</td>
        <td>${escapeHtml(row.carrier_name || "—")}</td>
        <td>
          <div><strong>${escapeHtml(row.exception_type || "—")}</strong></div>
          <div>${escapeHtml(row.exception_reason || "—")}</div>
        </td>
        <td>${escapeHtml(formatDate(row.uploaded_at))}</td>
        <td><button class="btn-inline" type="button" data-open-pdf="${row.document_id}">Open PDF</button></td>
        <td>
          <div class="actions">
            <button class="btn-inline" type="button" data-doc-toggle-resolve="${row.exception_id}">Resolve</button>
            <button class="btn-inline is-danger" type="button" data-doc-close="${row.exception_id}">Close</button>
          </div>
        </td>
      `;
      docQueueBody.appendChild(tr);

      if (state.documentReview.expandedExceptionId === row.exception_id) {
        const resolveRow = document.createElement("tr");
        resolveRow.className = "resolve-row";
        resolveRow.innerHTML = `<td colspan="6">${docResolveFormHtml(row)}</td>`;
        docQueueBody.appendChild(resolveRow);
      }
    }
  }

  function renderNormalizationRows() {
    normQueueBody.innerHTML = "";

    if (!state.normalization.rows.length) {
      normEmptyState.hidden = false;
      return;
    }

    normEmptyState.hidden = true;

    for (const row of state.normalization.rows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(row.dot_number)}</td>
        <td>${escapeHtml(row.carrier_name || "—")}</td>
        <td>
          <div><strong>${escapeHtml(row.exception_type || "—")}</strong></div>
          <div>${escapeHtml(row.exception_reason || "—")}</div>
          <div class="muted">Source: ${escapeHtml(row.source_coverage_type || "—")} / ${escapeHtml(row.source_coverage_type_raw || "—")}</div>
        </td>
        <td>${escapeHtml(formatDate(row.uploaded_at))}</td>
        <td><button class="btn-inline" type="button" data-open-pdf="${row.document_id}">Open PDF</button></td>
        <td>
          <div class="actions">
            <button class="btn-inline" type="button" data-norm-toggle-resolve="${row.exception_id}">Resolve</button>
            <button class="btn-inline is-danger" type="button" data-norm-close="${row.exception_id}">Close</button>
          </div>
        </td>
      `;
      normQueueBody.appendChild(tr);

      if (state.normalization.expandedExceptionId === row.exception_id) {
        const resolveRow = document.createElement("tr");
        resolveRow.className = "resolve-row";
        resolveRow.innerHTML = `<td colspan="6">${normResolveFormHtml(row)}</td>`;
        normQueueBody.appendChild(resolveRow);
      }
    }
  }

  async function openPdf(documentId) {
    if (!documentId) throw new Error("No document available for this exception.");
    const data = await apiGet(`/api/insurance/documents/${encodeURIComponent(documentId)}/signed-url`);
    if (!data?.signedUrl) throw new Error("Signed URL not returned.");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  function wireHandlers() {
    document.querySelectorAll("[data-open-pdf]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        clearStatus();
        try {
          await openPdf(btn.getAttribute("data-open-pdf"));
        } catch (error) {
          showStatus(error.message || "Failed to open PDF.");
        }
      });
    });

    document.querySelectorAll("[data-doc-toggle-resolve]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const exceptionId = btn.getAttribute("data-doc-toggle-resolve");
        state.documentReview.expandedExceptionId =
          state.documentReview.expandedExceptionId === exceptionId ? null : exceptionId;
        renderDocumentReviewRows();
        wireHandlers();
      });
    });

    document.querySelectorAll("[data-doc-close-resolve]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.documentReview.expandedExceptionId = null;
        renderDocumentReviewRows();
        wireHandlers();
      });
    });

    document.querySelectorAll("[data-doc-close]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const exceptionId = btn.getAttribute("data-doc-close");
        btn.disabled = true;
        clearStatus();
        try {
          await apiPost(`/api/admin/insurance/document-review-exceptions/${encodeURIComponent(exceptionId)}/resolve`, {
            action: "CLOSE",
          });
          showStatus("Document review exception closed.", "success");
          await loadDocumentReviewQueue(true);
        } catch (error) {
          showStatus(error.message || "Failed to close exception.");
        } finally {
          btn.disabled = false;
        }
      });
    });

    document.querySelectorAll("[data-norm-toggle-resolve]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const exceptionId = btn.getAttribute("data-norm-toggle-resolve");
        state.normalization.expandedExceptionId =
          state.normalization.expandedExceptionId === exceptionId ? null : exceptionId;
        renderNormalizationRows();
        wireHandlers();
      });
    });

    document.querySelectorAll("[data-norm-close-resolve]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.normalization.expandedExceptionId = null;
        renderNormalizationRows();
        wireHandlers();
      });
    });

    document.querySelectorAll("[data-norm-close]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const exceptionId = btn.getAttribute("data-norm-close");
        btn.disabled = true;
        clearStatus();
        try {
          await apiPost(`/api/admin/insurance/normalization-exceptions/${encodeURIComponent(exceptionId)}/resolve`, {
            action: "CLOSE",
          });
          showStatus("Normalization exception closed.", "success");
          await loadNormalizationQueue(true);
        } catch (error) {
          showStatus(error.message || "Failed to close exception.");
        } finally {
          btn.disabled = false;
        }
      });
    });

    document.querySelectorAll(".doc-resolve-form").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearStatus();

        const exceptionId = form.getAttribute("data-exception-id");
        const submitBtn = form.querySelector("button[type='submit']");
        submitBtn.disabled = true;

        const fd = new FormData(form);
        const payload = {
          action: "SAVE_COVERAGE",
          coverage_type: String(fd.get("coverage_type") || ""),
          coverage_type_raw: String(fd.get("coverage_type_raw") || ""),
          insurer_letter: String(fd.get("insurer_letter") || ""),
          insurer_name: String(fd.get("insurer_name") || ""),
          policy_number: String(fd.get("policy_number") || ""),
          effective_date: String(fd.get("effective_date") || ""),
          expiration_date: String(fd.get("expiration_date") || ""),
          limit_label: String(fd.get("limit_label") || ""),
          currency: String(fd.get("currency") || "USD"),
          amount: Number(fd.get("amount") || "0"),
        };

        try {
          await apiPost(`/api/admin/insurance/document-review-exceptions/${encodeURIComponent(exceptionId)}/resolve`, payload);
          showStatus("Coverage inserted and document review exception resolved.", "success");
          state.documentReview.expandedExceptionId = null;
          await loadDocumentReviewQueue(true);
        } catch (error) {
          showStatus(error.message || "Failed to save coverage.");
        } finally {
          submitBtn.disabled = false;
        }
      });
    });

    document.querySelectorAll(".norm-resolve-form").forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearStatus();

        const exceptionId = form.getAttribute("data-exception-id");
        const submitBtn = form.querySelector("button[type='submit']");
        submitBtn.disabled = true;

        const fd = new FormData(form);
        const payload = {
          action: "SAVE_COVERAGE",
          normalized_coverage_type: String(fd.get("normalized_coverage_type") || ""),
          selected_limit_amount: Number(fd.get("selected_limit_amount") || "0"),
        };

        try {
          const response = await apiPost(
            `/api/admin/insurance/normalization-exceptions/${encodeURIComponent(exceptionId)}/resolve`,
            payload
          );

          const fnResult = response?.result;
          if (!fnResult) {
            showStatus("Coverage saved, but resolve result was empty.", "success");
          } else if (fnResult.out_result_status && fnResult.out_result_status !== "RESOLVED") {
            showStatus(
              `Resolve returned ${fnResult.out_result_status}: ${fnResult.out_message || "No message."}`,
              "error"
            );
          } else {
            showStatus(fnResult.out_message || "Coverage saved.", "success");
          }

          state.normalization.expandedExceptionId = null;
          await loadNormalizationQueue(true);
        } catch (error) {
          showStatus(error.message || "Failed to save coverage.");
        } finally {
          submitBtn.disabled = false;
        }
      });
    });
  }

  async function loadDocumentReviewQueue(force = false) {
    if (state.loading["document-review"]) return;
    if (state.documentReview.loaded && !force) return;

    state.loading["document-review"] = true;
    refreshBtn.disabled = true;

    try {
      const payload = await apiGet("/api/admin/insurance/document-review-exceptions");
      state.documentReview.rows = Array.isArray(payload.rows) ? payload.rows : [];
      state.documentReview.loaded = true;
      renderDocumentReviewRows();
      wireHandlers();
    } catch (error) {
      state.documentReview.rows = [];
      renderDocumentReviewRows();
      showStatus(error.message || "Failed to load document review queue.");
    } finally {
      state.loading["document-review"] = false;
      refreshBtn.disabled = false;
    }
  }

  async function loadNormalizationQueue(force = false) {
    if (state.loading.normalization) return;
    if (state.normalization.loaded && !force) return;

    state.loading.normalization = true;
    refreshBtn.disabled = true;

    try {
      const payload = await apiGet("/api/admin/insurance/normalization-exceptions");
      state.normalization.rows = Array.isArray(payload.rows) ? payload.rows : [];
      state.normalization.loaded = true;
      renderNormalizationRows();
      wireHandlers();
    } catch (error) {
      state.normalization.rows = [];
      renderNormalizationRows();
      showStatus(error.message || "Failed to load normalization queue.");
    } finally {
      state.loading.normalization = false;
      refreshBtn.disabled = false;
    }
  }

  async function onTabChange(tab) {
    state.activeTab = tab;
    renderTabs();

    if (tab === "document-review") {
      await loadDocumentReviewQueue();
      return;
    }

    await loadNormalizationQueue();
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      clearStatus();
      await onTabChange(btn.getAttribute("data-tab"));
    });
  });

  refreshBtn.addEventListener("click", async () => {
    clearStatus();
    if (state.activeTab === "document-review") {
      await loadDocumentReviewQueue(true);
      return;
    }
    await loadNormalizationQueue(true);
  });

  window.addEventListener("DOMContentLoaded", async () => {
    await loadHeader();
    renderTabs();
    await loadDocumentReviewQueue(true);
  });
})();
