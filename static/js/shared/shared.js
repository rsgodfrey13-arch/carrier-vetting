//shared

async function loadHeader() {
  const container = document.getElementById("site-header");
  if (!container) return;

  try {
    const res = await fetch("/partials/header.html", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load header.html");

    container.innerHTML = await res.text();

    // 🔥 Header is NOW in the DOM → wire buttons
    await initAuthUI();
  } catch (err) {
    console.error("Header load failed:", err);
  }
}

async function trackPageViewLoggedIn(pathname) {
  try {
    // client-side dedupe: only once per tab/session per path
    const key = `pv:${pathname}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");

    await fetch("/api/internal/track/pageview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname }),
      keepalive: true, // helps if user navigates away quickly
    });
  } catch (_) {
    // swallow errors
  }
}

async function initAuthUI() {
  const loginBtn = document.getElementById("login-btn");
  const logoutBtn = document.getElementById("logout-btn");

  // If this page doesn't have the header, just skip.
  if (!loginBtn || !logoutBtn) return;

  // Login button always goes to login page
  loginBtn.onclick = () => {
    window.location.href = "/login.html";
  };

  try {
    const res = await fetch("/api/me", { cache: "no-store" });
    const data = await res.json();

    if (data.user) {
      // Logged in
      loginBtn.style.display = "none";
      logoutBtn.style.display = "inline-block";

      // ✅ Track page view only for logged-in users
      trackPageViewLoggedIn(window.location.pathname);

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

document.addEventListener("DOMContentLoaded", loadHeader);
