
async function loadHeader() {
  const container = document.getElementById("site-header");
  if (!container) return;

  try {
    const res = await fetch("/partials/header.html");
    if (!res.ok) throw new Error("Failed to load header");

    container.innerHTML = await res.text();
  } catch (err) {
    console.error("Header load failed:", err);
  }
}

document.addEventListener("DOMContentLoaded", loadHeader);
