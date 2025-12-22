"use strict";

const express = require("express");
const path = require("path");

const { internalRoutes } = require("../routes/internal");
const { publicRoutes } = require("../routes/public");

// NOTE: we’ll add external /api/v1 wiring later when that file exists
// const { externalRoutes } = require("../routes/external/v1.routes");

function createApp() {
  const app = express();

  // If you're behind a proxy (DigitalOcean App Platform)
  app.set("trust proxy", 1);

  // Serve static files from /static (your Phase 1 move)
  app.use(express.static(path.join(__dirname, "../../static")));

  // Parse JSON bodies
  app.use(express.json());

  // Public (no-auth) routes first (contract token pages, /:dot, etc.)
  app.use(publicRoutes());

  // Internal (session-based) APIs mounted under /api
  app.use("/api", internalRoutes());

  // External API key routes (we’ll enable after v1.routes.js exists)
  // app.use("/api/v1", externalRoutes());

  return app;
}

module.exports = { createApp };
