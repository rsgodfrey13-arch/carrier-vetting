// /src/static/js/shared/sentry.js
(function () {
  // If the Sentry CDN script isn't loaded, do nothing.
  if (!window.Sentry) return;

  // Avoid double-init if included twice by accident
  if (window.__SENTRY_INIT__) return;
  window.__SENTRY_INIT__ = true;

  window.Sentry.init({
    dsn: "https://YOUR_FRONTEND_DSN_HERE",
    environment: "production",
    tracesSampleRate: 0.0, // keep off for now (cheap + simple)
    // Optional: helps group similar errors
    normalizeDepth: 5,
  });

  // Catch anything that would otherwise only show up in console
  window.addEventListener("error", (e) => {
    if (e && e.error) {
      try { window.Sentry.captureException(e.error); } catch {}
    }
  });

  window.addEventListener("unhandledrejection", (e) => {
    try {
      window.Sentry.captureException(e.reason || new Error("Unhandled rejection"));
    } catch {}
  });

  // Helper you can call anywhere without thinking
  window.captureToSentry = function (err, extra) {
    try {
      if (!window.Sentry) return;
      window.Sentry.withScope((scope) => {
        if (extra && typeof extra === "object") scope.setExtras(extra);
        window.Sentry.captureException(err);
      });
    } catch {}
  };
})();
