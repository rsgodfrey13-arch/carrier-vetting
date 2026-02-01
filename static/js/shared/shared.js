async function loadHeader() {
  const container = document.getElementById("site-header");
  if (!container) return;

  try {
    const res = await fetch("/partials/header.html", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load header.html");

    container.innerHTML = await res.text();

    // Header is now in the DOM → wire buttons
    await initAuthUI();
  } catch (err) {
    console.error("Header load failed:", err);
  }
}

async function trackHomepageView() {
  // only track homepage
  if (window.location.pathname !== "/") return;

  // dedupe once per tab/session
  const key = "pv:/";
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");

  const r = await fetch("/pageview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "/" }),
    keepalive: true
  });

  if (!r.ok) {
    console.error("pageview failed:", r.status, await r.text().catch(() => ""));
  }
}


async function initAuthUI() {
  const loginBtn = document.getElementById("login-btn");
  const logoutBtn = document.getElementById("logout-btn");
  const accountLink = document.getElementById("account-link");

  // If this page doesn't have the header, just skip.
  if (!loginBtn || !logoutBtn) return;

  loginBtn.onclick = () => {
    window.location.href = "/login";
  };

  try {
    const res = await fetch("/api/me", { cache: "no-store" });
    const data = await res.json();

    if (data.user) {
      // ✅ Logged in
      loginBtn.style.display = "none";
      logoutBtn.style.display = "inline-block";

      if (accountLink) {
        accountLink.style.display = "inline-block";
        accountLink.onclick = () => {
          window.location.href = "/account";
        };
      }

      logoutBtn.onclick = async () => {
        await fetch("/api/logout", { method: "POST" });
        window.location.href = "/";
      };
    } else {
      // ❌ Not logged in
      loginBtn.style.display = "inline-block";
      logoutBtn.style.display = "none";

      if (accountLink) {
        accountLink.style.display = "inline-block";
        accountLink.onclick = () => {
          window.location.href = "/login";
        };
      }
    }
  } catch (err) {
    console.error("auth ui error", err);

    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";

    if (accountLink) {
      accountLink.style.display = "inline-block";
      accountLink.onclick = () => {
        window.location.href = "/login";
      };
    }
  }
}


// Run both on page load
document.addEventListener("DOMContentLoaded", () => {
  trackHomepageView(); // ✅ logs whether logged in or not
  loadHeader();        // ✅ keeps your header/auth behavior
});
