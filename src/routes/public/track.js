// routes/public/track.js
const express = require("express");
const crypto = require("crypto");

const router = express.Router();

function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash("sha256").update(ip).digest("hex");
}

// You can also add a very simple dedupe: one event per user per path per X minutes.
router.post("/pageview", async (req, res) => {
  try {
    const user = req.user || req.session?.user; // adapt to your auth
    if (!user?.id) return res.status(401).json({ ok: false });

    const path = (req.body?.path || "/").toString().slice(0, 200);

    const ip =
      (req.headers["cf-connecting-ip"] ||
        req.headers["x-forwarded-for"] ||
        req.socket?.remoteAddress ||
        "")
        .toString()
        .split(",")[0]
        .trim();

    const ua = (req.headers["user-agent"] || "").toString().slice(0, 300);

    // Optional: 10-minute dedupe per user+path
    // Only count once per 10 minutes to avoid refresh spam
    const dedupeMinutes = 10;

    await req.db.query(
      `
      INSERT INTO public.page_view_events (user_id, path, session_id, ip_hash, user_agent)
      SELECT $1, $2, $3, $4, $5
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.page_view_events
        WHERE user_id = $1
          AND path = $2
          AND occurred_at > now() - ($6::text || ' minutes')::interval
      )
      `,
      [
        user.id,
        path,
        req.sessionID || null,
        hashIp(ip),
        ua,
        dedupeMinutes,
      ]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

module.exports = { trackRoutes: router };
