"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("login-error");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (errorEl) {
      errorEl.style.display = "none";
      errorEl.textContent = "";
    }

    const email = (document.getElementById("email")?.value || "").trim();
    const password = document.getElementById("password")?.value || "";

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        if (errorEl) {
          errorEl.textContent = data.error || "Login failed";
          errorEl.style.display = "block";
        }
        return;
      }

      // success → cookie set by server → redirect to home
      window.location.href = "/";
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = "Network error, please try again.";
        errorEl.style.display = "block";
      }
    }
  });
});
