// src/routes/public/track.js
const express = require("express");
const crypto = require("crypto");

const router = express.Router();

function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash("sha256").update(ip).digest("hex");
}

function getClientIp(req) {
  return (
    req.headers["cf-connecting-ip"] ||
    req.headers["x-forwarded-for"] ||
    req.socket?.remoteAddress ||
    ""
  )
    .toString()
    .split(",")[0]
    .trim();
}

async function insertPageview(req, path) {
  const user = req.user || req.session?.user || null;
  const userId = user?.id ?? null;

  const ip = getClientIp(req);
  const ua = (req.headers["user-agent"] || "").toString().slice(0, 300);

  const ipHash = hashIp(ip);
  const sessionId = req.sessionID || null;

  const dedupeMinutes = 10;

  await req.db.query(
    `
    INSERT INTO public.page_view_events (user_id, path, session_id, ip_hash, user_agent)
    SELECT $1, $2, $3, $4, $5
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.page_view_events
      WHERE path = $2
        AND occurred_at > now() - make_interval(mins => $6)
        AND (
          ($1 IS NOT NULL AND user_id = $1)
          OR
          ($1 IS NULL AND $3 IS NOT NULL AND session_id = $3)
          OR
          ($1 IS NULL AND $3 IS NULL AND ip_hash = $4 AND user_agent = $5)
        )
    )
    `,
    [userId, path, sessionId, ipHash, ua, dedupeMinutes]
  );
}

// ✅ GET version (supports pixel-style hits, prevents noisy 404s)
router.get("/pageview", async (req, res) => {
  try {
    const path = (req.query?.path || "/").toString().slice(0, 200);
    await insertPageview(req, path);
    res.status(204).end();
  } catch (e) {
    console.error("track pageview GET error:", e);
    res.status(204).end(); // never break the page
  }
});

// ✅ POST version (your current fetch() usage)
router.post("/pageview", async (req, res) => {
  try {
    const path = (req.body?.path || "/").toString().slice(0, 200);
    await insertPageview(req, path);
    res.json({ ok: true });
  } catch (e) {
    console.error("track pageview POST error:", e);
    res.status(500).json({ ok: false });
  }
});

module.exports = router;
