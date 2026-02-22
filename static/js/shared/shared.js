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


function setHelpMenu(isLoggedIn) {
  const helpLabel = document.getElementById("help-label");
  const helpMenu = document.getElementById("help-menu");
  const demoLink = document.getElementById("demo-link");

  // If header isn't present on this page, skip
  if (!helpLabel || !helpMenu) return;

  if (isLoggedIn) {
    // LOGGED IN: Support menu
    helpLabel.innerHTML = `Support <span class="nav-caret">▾</span>`;
    helpLabel.setAttribute("href", "/account#help");

    // hide marketing CTA
    if (demoLink) demoLink.style.display = "none";

    helpMenu.innerHTML = `
      <a href="/help" class="nav-dd-link" role="menuitem">Help Center</a>
      <a href="/account#help" class="nav-dd-link" role="menuitem">Open a Support Ticket</a>
      <a href="/faq" class="nav-dd-link" role="menuitem">FAQs</a>
      <div class="nav-dd-sep"></div>
      <a href="/contact" class="nav-dd-link" role="menuitem">Contact Sales</a>
    `;
  } else {
    // LOGGED OUT: Help menu
    helpLabel.innerHTML = `Help <span class="nav-caret">▾</span>`;
    helpLabel.setAttribute("href", "/help");

    // show marketing CTA
    if (demoLink) demoLink.style.display = "inline-flex";

    helpMenu.innerHTML = `
      <a href="/demo" class="nav-dd-link" role="menuitem">Get a Demo</a>
      <a href="/contact" class="nav-dd-link" role="menuitem">Contact Us</a>
      <div class="nav-dd-sep"></div>
      <a href="/help" class="nav-dd-link" role="menuitem">Help Center</a>
      <a href="/faq" class="nav-dd-link" role="menuitem">FAQs</a>
    `;
  }
}


async function initAuthUI() {
  const loginBtn = document.getElementById("login-btn");
  const logoutBtn = document.getElementById("logout-btn");
  const demoLink = document.getElementById("demo-link");
  const helpLabel = document.getElementById("help-label");

  if (!loginBtn || !logoutBtn) return;

  loginBtn.onclick = () => {
    window.location.href = "/login";
  };

  try {
    const res = await fetch("/api/me", { cache: "no-store" });
    const data = await res.json();

    if (data.user) {
      // =============================
      // LOGGED IN STATE
      // =============================

      loginBtn.style.display = "none";
      logoutBtn.style.display = "inline-block";

      logoutBtn.onclick = async () => {
        await fetch("/api/logout", { method: "POST" });
        window.location.href = "/";
      };
      // Set Help Menu True
      setHelpMenu(true);
      
      // Hide marketing CTA
      if (demoLink) demoLink.style.display = "none";

      // Rename Help → Support
      if (helpLabel) {
        helpLabel.innerHTML = `Support <span class="nav-caret">▾</span>`;
        helpLabel.setAttribute("href", "/account#help");
      }

    } else {
      // =============================
      // NOT LOGGED IN
      // =============================

      // Set Help Menu False
      setHelpMenu(false);

      loginBtn.style.display = "inline-block";
      logoutBtn.style.display = "none";

      if (demoLink) demoLink.style.display = "inline-flex";

      if (helpLabel) {
        helpLabel.innerHTML = `Help <span class="nav-caret">▾</span>`;
        helpLabel.setAttribute("href", "/help");
      }
    }
  } catch (err) {
    console.error("auth ui error", err);

    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";

    // Set Help Menu False
    setHelpMenu(false);

    if (demoLink) demoLink.style.display = "inline-flex";
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
