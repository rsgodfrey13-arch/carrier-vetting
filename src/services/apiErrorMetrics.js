// apiErrorMetrics.js
const pool = require("../db/pool");

const UPSERT_SQL = `
INSERT INTO api_error_metrics (
  bucket_start,
  service_name,
  vendor,
  endpoint,
  error_class,
  status_code,
  count,
  last_message,
  last_seen_at
)
VALUES (
  date_trunc('hour', now()),
  $1, $2, $3, $4, $5,
  1, $6, now()
)
ON CONFLICT (bucket_start, service_name, vendor, endpoint, error_class, status_code)
DO UPDATE SET
  count = api_error_metrics.count + 1,
  last_message = EXCLUDED.last_message,
  last_seen_at = now();
`;

// Keep this SHORT so logging never makes prod slower.
const LOG_TIMEOUT_MS = 150;

function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error("api_error_metrics_timeout")), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

function safeTrim(str, max = 400) {
  if (!str) return null;
  const s = String(str);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// You can expand this over time without changing schema.
function classifyError({ statusCode, code, message }) {
  if (statusCode === 429) return "RATE_LIMIT";
  if (statusCode === 401 || statusCode === 403) return "AUTH";
  if (statusCode >= 500 && statusCode <= 599) return "VENDOR_5XX";
  if (statusCode >= 400 && statusCode <= 499) return "VENDOR_4XX";

  const m = (message || "").toLowerCase();
  const c = (code || "").toUpperCase();

  if (c === "ETIMEDOUT" || m.includes("timeout")) return "TIMEOUT";
  if (c === "ECONNRESET") return "CONN_RESET";
  if (c === "ENOTFOUND" || m.includes("dns")) return "DNS";
  if (c === "ECONNREFUSED") return "CONN_REFUSED";

  return "UNKNOWN";
}

// Extract endpoint path only (avoid logging tokens in query strings).
function endpointFromUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname || "/";
  } catch {
    return safeTrim(url, 200) || "unknown";
  }
}

/**
 * Best-effort logging: never throw, never block your main logic for long.
 */
async function logApiErrorMetric({
  serviceName = "nodeexpress",
  vendor = "unknown",
  url,
  endpoint, // optional override
  statusCode = null,
  code = null,
  message = null,
}) {
  const ep = endpoint || endpointFromUrl(url);
  const errorClass = classifyError({ statusCode, code, message });

  const lastMessage = safeTrim(message, 400);

  const queryPromise = pool.query(UPSERT_SQL, [
    serviceName,
    vendor,
    ep,
    errorClass,
    statusCode,
    lastMessage,
  ]);

  try {
    await withTimeout(queryPromise, LOG_TIMEOUT_MS);
  } catch (e) {
    // Fallback: DO logs / stdout will still capture this
    // so you don't go blind when PG is down.
    console.error("[api_error_metrics] write_failed", {
      vendor,
      endpoint: ep,
      statusCode,
      errorClass,
      reason: e.message,
    });
  }
}

module.exports = { logApiErrorMetric };
