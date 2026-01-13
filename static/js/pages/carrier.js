// static/js/pages/carrier.js
(() => {
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

  function getDotFromPath() {
    const path = window.location.pathname.replace(/^\//, "");
    return path ? decodeURIComponent(path) : "";
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

  async function loadCarrier() {
    const dot = getDotFromPath();
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
    const addBtn = document.getElementById("btn-add-carrier");
    const removeBtn = document.getElementById("btn-remove-carrier");
    if (!addBtn || !removeBtn) return;

    function setState({ isSaved, isLoggedIn }) {
      if (!isLoggedIn) {
        addBtn.textContent = "Login to Add";
        addBtn.classList.remove("added");
        addBtn.classList.add("pill-disabled");

        removeBtn.classList.add("pill-disabled");
        removeBtn.classList.remove("active");
        return;
      }

      if (isSaved) {
        addBtn.textContent = "Added";
        addBtn.classList.add("added", "pill-disabled");

        removeBtn.textContent = "Remove Carrier";
        removeBtn.classList.remove("pill-disabled");
        removeBtn.classList.add("active");
      } else {
        addBtn.textContent = "+ Add Carrier";
        addBtn.classList.remove("added", "pill-disabled");

        removeBtn.textContent = "Remove Carrier";
        removeBtn.classList.add("pill-disabled");
        removeBtn.classList.remove("active");
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
      return;
    }

    // saved?
    let isSaved = false;
    try {
      const checkRes = await fetch(`/api/my-carriers/${encodeURIComponent(dot)}`);
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        isSaved = !!checkData.saved;
      } else if (checkRes.status === 404) {
        isSaved = false;
      }
    } catch (err) {
      console.error("check saved failed", err);
    }

    setState({ isSaved, isLoggedIn: true });

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
          setState({ isSaved: true, isLoggedIn: true });
        } else {
          alert(body.error || "Failed to add carrier.");
        }
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
          setState({ isSaved: false, isLoggedIn: true });
        } else {
          alert(body.error || "Failed to remove carrier.");
        }
      } catch (err) {
        console.error("remove carrier failed", err);
        alert("Network error removing carrier.");
      }
    };
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
  document.addEventListener("DOMContentLoaded", loadCarrier);
})();
