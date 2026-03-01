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

  if (btn && termsCheckbox) {

    // Start disabled
    btn.disabled = true;
    if (helper) helper.style.display = "block";

    termsCheckbox.addEventListener("change", () => {
      const agreed = termsCheckbox.checked;
      btn.disabled = !agreed;

      if (helper) {
        helper.style.display = agreed ? "none" : "block";
      }
    });

    btn.addEventListener("click", startCheckout);
  }

})();
