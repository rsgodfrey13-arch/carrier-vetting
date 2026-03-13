(() => {
  const STORAGE_KEY = "cs_tour_seen_v1";

  const kickerEl = document.querySelector(".cs-tour-kicker");
const btnGo = document.getElementById("tourGo");

  
const slides = [
  {
    title: "One place to verify, document, and monitor carriers.",
    body: "Carrier Shark is a carrier management platform structured for onboarding, agreements, insurance, and change alerts. Take the quick tour to learn more."
  },
  {
    title: "Search any Carrier",
    body: "Search by DOT, MC, or carrier name across all FMCSA carriers.",
    img: "/static/images/tour/search_carrier.png"
  },
  {
    title: "Open the carrier profile",
    body: `
  The carrier profile contains everything you need to vet a carrier:
  <br><br>
  • Authority & operating status<br>
  • Safety & inspection history<br>
  • Equipment & operations<br>
  • Insurance coverage<br>
  • Agreements & documents
  `,
    img: "/static/images/tour/carrier_profile.png"
  },
  {
    title: "Build a private watchlist of the carriers you use.",
    body: "Save carriers you actually work with so Carrier Shark can help you monitor contracts, insurance, and status changes over time.",
    img: "/static/images/tour/my_carriers.png"
  },
  {
    title: "Send agreements and keep docs organized.",
    body: "Centralize contracts and insurance documents in one place.",
    img: "/static/images/tour/send_contract.png"
  },
  {
    title: "Get alerts when something changes.",
    body: "Stay on top of authority changes, insurance expirations, and safety shifts.",
    img: "/static/images/tour/alerts.png"
  },
  {
    title: "You’re ready.",
    body: "Start by searching a carrier, open the profile, and add it to My Carriers.",
    img: "/static/images/tour/my_account.png",
    cta: { text: "Create account", href: "/signup" }
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
  const stepCount = slides.length - 1;           // exclude slide 0
  const stepIndex = Math.max(0, idx - 1);        // slide 1 => 0

  dotsEl.innerHTML = Array.from({ length: stepCount }, (_, i) =>
    `<button type="button" class="cs-dot ${i === stepIndex ? "is-active" : ""}"
      aria-label="Step ${i + 1}"></button>`
  ).join("");

  [...dotsEl.querySelectorAll(".cs-dot")].forEach((b, i) => {
    b.addEventListener("click", () => {
      idx = i + 1;   // jump to real slide (offset by 1)
      render();
    });
  });
}

function render() {
  const s = slides[idx];

  if (kickerEl) {
  kickerEl.textContent = (idx === 0) ? "" : "QUICK TOUR";
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

// Next button + secondary button logic
if (idx === 0) {
  btnNext.textContent = "Take the Tour";
  btnNext.classList.add("cs-btn-tour-hero");

  if (btnGo) btnGo.style.display = "";
  if (skipLink) skipLink.style.display = "none";
} else {
  btnNext.classList.remove("cs-btn-tour-hero");

  // ✅ reset the label properly for tour slides
  btnNext.textContent = (idx === slides.length - 1) ? "Done" : "Next";

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
