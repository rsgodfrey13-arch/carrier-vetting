async function loadHeader() {
  const container = document.getElementById("site-header");
  if (!container) return;

  try {
    const res = await fetch("/partials/header.html", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load header.html");

    container.innerHTML = await res.text();

    // Header is now in the DOM → wire buttons
    await initAuthUI();
    await initAccountLink();
  } catch (err) {
    console.error("Header load failed:", err);
  }
}


async function loadHeaderSlim() {
  const container = document.getElementById("site-header");
  if (!container) return;

  try {
    const res = await fetch("/partials/header-slim.html", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load header-slim.html");

    container.innerHTML = await res.text();

    // Same wiring as full header
    await initAuthUI();
    await initAccountLink();
  } catch (err) {
    console.error("Header slim load failed:", err);
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

  // If this page doesn't have the header, just skip.
  if (!loginBtn || !logoutBtn) return;

  loginBtn.onclick = () => {
    window.location.href = "/login";
  };

  try {
    const res = await fetch("/api/me", { cache: "no-store" });
    const data = await res.json();

    if (data.user) {
      // Logged in
      loginBtn.style.display = "none";
      logoutBtn.style.display = "inline-block";

      logoutBtn.onclick = async () => {
        await fetch("/api/logout", { method: "POST" });
        window.location.href = "/";
      };
    } else {
      // Not logged in
      loginBtn.style.display = "inline-block";
      logoutBtn.style.display = "none";
    }
  } catch (err) {
    console.error("auth ui error", err);
    // If /api/me fails, default to showing Login
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
  }
}


async function initAccountLink() {
  const accountLink = document.getElementById("account-link");
  if (!accountLink) return;

  try {
    const res = await fetch("/api/me", { cache: "no-store" });
    const data = await res.json();

    if (data && data.user) {
      // Logged in → upgrade link
      accountLink.href = "/account";
    }
    // Not logged in → leave href as /login.html
  } catch {
    // On any error, do nothing.
    // Default /login.html remains correct.
  }
}

async function loadFooter() {
  const container = document.getElementById("site-footer");
  if (!container) return;

  try {
    const res = await fetch("/partials/footer.html", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load footer.html");

    container.innerHTML = await res.text();

    // Auto year (safe to run after injection)
    const y = new Date().getFullYear();
    const yearEl = document.getElementById("footer-year");
    if (yearEl) yearEl.textContent = y;

  } catch (err) {
    console.error("Footer load failed:", err);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  trackHomepageView();

  const headerEl = document.getElementById("site-header");
  const mode = headerEl ? headerEl.getAttribute("data-header") : null;

  if (mode === "slim") {
    await loadHeaderSlim();
  } else {
    await loadHeader();
  }

  await loadFooter();
});
