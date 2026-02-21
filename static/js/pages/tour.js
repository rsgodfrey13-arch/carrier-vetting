(() => {
  const STORAGE_KEY = "cs_tour_seen_v1";

  const kickerEl = document.querySelector(".cs-tour-kicker");
const btnGo = document.getElementById("tourGo");

  
  const slides = [
    {
      title: "One place to verify, document, and monitor carriers.",
      body: "Carrier Shark is a carrier management platform Structured for onboarding, agreements, insurance, and change alerts. Take the quick tour to learn more."
    },
    {
      title: "Search any DOT, MC, or carrier name.",
      body: "Instant authority + safety signals. No digging.",
      img: "/static/help-art/image.png"
    },
    {
      title: "Build your private carrier list.",
      body: "Add carriers you actually work with so you can monitor them.",
      img: "/static/help-art/image.png"
    },
    {
      title: "Send agreements and keep docs organized.",
      body: "Centralize contracts + insurance docs in one place.",
      img: "/static/help-art/image.png"
    },
    {
      title: "Get alerts when something changes.",
      body: "Authority flips, insurance expirations, safety shifts.",
      img: "/static/help-art/image.png"
    },
    {
      title: "You’re ready.",
      body: "Start by searching a carrier, then add it to My Carriers.",
      img: "/static/help-art/image.png",
      cta: { text: "Create account", href: "/signup" } // optional for logged-out
    }
  ];

  const overlay = document.getElementById("tourOverlay");
  const titleEl = document.getElementById("tourTitle");
  const bodyEl  = document.getElementById("tourBody");
  const imgEl   = document.getElementById("tourImg");
  const dotsEl  = document.getElementById("tourDots");

  const btnPrev = document.getElementById("tourPrev");
  const btnNext = document.getElementById("tourNext");
  const btnClose = document.getElementById("tourClose");
  const dontShowEl = document.getElementById("tourDontShow");
  const openLink = document.getElementById("openTourLink");
  const skipLink = document.getElementById("tourSkip");

  let idx = 0;

  function isSeen() {
    return localStorage.getItem(STORAGE_KEY) === "1";
  }

  function setSeen(val) {
    localStorage.setItem(STORAGE_KEY, val ? "1" : "0");
  }

  function openTour(startIndex = 0) {
    idx = Math.max(0, Math.min(slides.length - 1, startIndex));
    overlay.setAttribute("aria-hidden", "false");
    overlay.classList.add("is-open");
    render();
    // Lock scroll (optional)
    document.documentElement.classList.add("cs-modal-open");
  }

  function closeTour() {
    // Persist if checked
    if (dontShowEl.checked) setSeen(true);

    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("cs-modal-open");
  }

  function renderDots() {
    dotsEl.innerHTML = slides.map((_, i) =>
      `<button type="button" class="cs-dot ${i === idx ? "is-active" : ""}" aria-label="Slide ${i+1}"></button>`
    ).join("");

    [...dotsEl.querySelectorAll(".cs-dot")].forEach((b, i) => {
      b.addEventListener("click", () => { idx = i; render(); });
    });
  }

function render() {
  const s = slides[idx];

  if (kickerEl) {
  kickerEl.textContent = (idx === 0) ? "CARRIER SHARK" : "QUICK TOUR";
}

  

  const modal = overlay.querySelector(".cs-modal");
  modal.classList.toggle("cs-tour-intro", idx === 0);

  titleEl.textContent = s.title;
  bodyEl.innerHTML = "";

  const p = document.createElement("p");
  p.textContent = s.body;
  bodyEl.appendChild(p);

  if (s.cta) {
    const a = document.createElement("a");
    a.className = "cs-btn cs-btn-primary cs-tour-cta";
    a.href = s.cta.href;
    a.textContent = s.cta.text;
    bodyEl.appendChild(a);
  }

  // Image handling
  if (s.img) {
    imgEl.style.display = "";
    imgEl.src = s.img;
  } else {
    imgEl.removeAttribute("src");
    imgEl.style.display = "none";
  }

  // Back button
  btnPrev.disabled = idx === 0;
  btnPrev.style.visibility = (idx === 0) ? "hidden" : "visible";

if (idx === 0) {
  btnNext.textContent = "Take the Tour";
  btnNext.classList.add("cs-btn-hero");

  if (btnGo) btnGo.style.display = "";
  if (skipLink) skipLink.style.display = "none";
} else {
  btnNext.classList.remove("cs-btn-hero");
  if (btnGo) btnGo.style.display = "none";
  if (skipLink) skipLink.style.display = "";
}
  renderDots();
}

  function next() {
    if (idx < slides.length - 1) { idx++; render(); }
    else closeTour();
  }
  function prev() {
    if (idx > 0) { idx--; render(); }
  }

  // Events
  btnNext?.addEventListener("click", next);
  btnPrev?.addEventListener("click", prev);
  btnClose?.addEventListener("click", closeTour);
  btnGo?.addEventListener("click", closeTour);

  
  // Click outside modal closes
  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) closeTour();
  });

  // Esc closes
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("is-open")) closeTour();
    if (e.key === "ArrowRight" && overlay.classList.contains("is-open")) next();
    if (e.key === "ArrowLeft" && overlay.classList.contains("is-open")) prev();
  });

  openLink?.addEventListener("click", (e) => {
    e.preventDefault();
    openTour(0);
  });

  skipLink?.addEventListener("click", (e) => {
    e.preventDefault();
    closeTour();
  });

  // Auto-show for first-time visitors (you can gate this by logged-in status)
  if (!isSeen()) {
    // optionally delay a bit so it doesn’t feel like a pop-ad
    setTimeout(() => openTour(0), 500);
  }
})();
