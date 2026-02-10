// /js/shared/sentry.js
(function () {
  if (!window.Sentry) return;

  // Prevent accidental double wiring
  if (window.__SENTRY_HELPERS__) return;
  window.__SENTRY_HELPERS__ = true;

  // Universal helper for caught errors
  window.captureToSentry = function (err, extra) {
    try {
      window.Sentry.withScope((scope) => {
        if (extra && typeof extra === "object") {
          scope.setExtras(extra);
        }
        window.Sentry.captureException(err);
      });
    } catch {}
  };

  // Safety net for promise rejections
  window.addEventListener("unhandledrejection", (e) => {
    window.captureToSentry(
      e.reason || new Error("Unhandled promise rejection"),
      { source: "unhandledrejection" }
    );
  });
})();
