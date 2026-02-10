"use strict";

const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || "production",
  release: process.env.SENTRY_RELEASE,
  sendDefaultPii: false,
});
