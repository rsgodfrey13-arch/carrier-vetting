(() => {
  const COVERAGE_TYPES = [
    "AUTO_LIABILITY",
    "CARGO",
    "GENERAL_LIABILITY",
    "UMBRELLA_LIABILITY",
    "WORKERS_COMP",
    "ERRORS_OMISSIONS",
    "CONTINGENT_AUTO_LIABILITY",
  ];

  const state = {
    rows: [],
    expandedExceptionId: null,
    loading: false,
  };

  const queueBody = document.getElementById("queue-body");
  const emptyState = document.getElementById("empty-state");
  const statusBanner = document.getElementById("status-banner");
  const refreshBtn = document.getElementById("refresh-btn");

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

  function getResolveFormHtml(row) {
    const coverageOptions = COVERAGE_TYPES.map((v) => `<option value="${v}">${v}</option>`).join("");

    return `
      <div class="resolve-panel">
        <form class="resolve-form" data-exception-id="${row.exception_id}">
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
            <button class="btn-inline" type="submit">Save Coverage</button>
            <button class="btn-inline" type="button" data-close-resolve="${row.exception_id}">Cancel</button>
          </div>
        </form>
      </div>
    `;
  }

  function renderRows() {
    queueBody.innerHTML = "";

    if (!state.rows.length) {
      emptyState.hidden = false;
      return;
    }

    emptyState.hidden = true;

    for (const row of state.rows) {
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
            <button class="btn-inline" type="button" data-toggle-resolve="${row.exception_id}">Resolve</button>
            <button class="btn-inline is-danger" type="button" data-ignore="${row.exception_id}">Ignore</button>
          </div>
        </td>
      `;
      queueBody.appendChild(tr);

      if (state.expandedExceptionId === row.exception_id) {
        const resolveRow = document.createElement("tr");
        resolveRow.className = "resolve-row";
        resolveRow.innerHTML = `<td colspan="6">${getResolveFormHtml(row)}</td>`;
        queueBody.appendChild(resolveRow);
      }
    }

    wireRowHandlers();
  }

  function wireRowHandlers() {
    queueBody.querySelectorAll("[data-open-pdf]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        clearStatus();
        const documentId = btn.getAttribute("data-open-pdf");
        try {
          if (!documentId) throw new Error("No document available for this exception.");
          const data = await apiGet(`/api/insurance/documents/${encodeURIComponent(documentId)}/signed-url`);
          if (!data?.signedUrl) throw new Error("Signed URL not returned.");
          window.open(data.signedUrl, "_blank", "noopener,noreferrer");
        } catch (error) {
          showStatus(error.message || "Failed to open PDF.");
        }
      });
    });

    queueBody.querySelectorAll("[data-toggle-resolve]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const exceptionId = btn.getAttribute("data-toggle-resolve");
        state.expandedExceptionId = state.expandedExceptionId === exceptionId ? null : exceptionId;
        renderRows();
      });
    });

    queueBody.querySelectorAll("[data-close-resolve]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.expandedExceptionId = null;
        renderRows();
      });
    });

    queueBody.querySelectorAll("[data-ignore]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const exceptionId = btn.getAttribute("data-ignore");
        btn.disabled = true;
        clearStatus();
        try {
          await apiPost(`/api/admin/insurance/normalization-exceptions/${encodeURIComponent(exceptionId)}/resolve`, {
            action: "IGNORE",
          });
          showStatus("Normalization exception ignored.", "success");
          await loadQueue();
        } catch (error) {
          showStatus(error.message || "Failed to ignore exception.");
        } finally {
          btn.disabled = false;
        }
      });
    });

    queueBody.querySelectorAll(".resolve-form").forEach((form) => {
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

          state.expandedExceptionId = null;
          await loadQueue();
        } catch (error) {
          showStatus(error.message || "Failed to save coverage.");
        } finally {
          submitBtn.disabled = false;
        }
      });
    });
  }

  async function loadQueue() {
    if (state.loading) return;
    state.loading = true;
    refreshBtn.disabled = true;

    try {
      const payload = await apiGet("/api/admin/insurance/normalization-exceptions");
      state.rows = Array.isArray(payload.rows) ? payload.rows : [];
      renderRows();
    } catch (error) {
      state.rows = [];
      renderRows();
      showStatus(error.message || "Failed to load queue.");
    } finally {
      state.loading = false;
      refreshBtn.disabled = false;
    }
  }

  refreshBtn.addEventListener("click", () => {
    clearStatus();
    loadQueue();
  });

  window.addEventListener("DOMContentLoaded", async () => {
    await loadHeader();
    await loadQueue();
  });
})();
