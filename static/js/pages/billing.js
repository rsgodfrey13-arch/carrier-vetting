// /js/billing.js
(function () {

  const btn = document.getElementById("checkout-btn");
  const statusEl = document.getElementById("billing-status");
  const planInput = document.getElementById("plan-input");
  const termsCheckbox = document.getElementById("terms-checkbox");
  const helper = document.getElementById("terms-helper");

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.style.display = "block";
    statusEl.textContent = msg;
    statusEl.style.opacity = isError ? "1" : ".9";
  }

  async function startCheckout() {
    const plan = (planInput?.value || "core").toLowerCase();

    btn.disabled = true;
    btn.classList.add("is-loading");
    setStatus("Redirecting to secure checkout…");

    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plan })
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Checkout failed (${res.status})`);
      }

      const data = await res.json();
      if (!data?.url) throw new Error("Missing checkout URL from server.");

      window.location.href = data.url;
    } catch (err) {
      console.error(err);
      setStatus(
        "Couldn’t start checkout. Please try again. If it keeps happening, contact support.",
        true
      );
      btn.disabled = false;
      btn.classList.remove("is-loading");
    }
  }

  if (btn) {

    // Start disabled
    btn.disabled = true;

    if (termsCheckbox) {

      // Show helper when user tries to hover disabled button
      btn.addEventListener("mouseenter", () => {
        if (!termsCheckbox.checked && helper) {
          helper.style.display = "block";
        }
      });

      btn.addEventListener("mouseleave", () => {
        if (helper) helper.style.display = "none";
      });

      // Toggle enable/disable
      termsCheckbox.addEventListener("change", () => {
        btn.disabled = !termsCheckbox.checked;

        if (helper) {
          helper.style.display = termsCheckbox.checked ? "none" : "block";
        }
      });
    }

    btn.addEventListener("click", startCheckout);
  }

})();
