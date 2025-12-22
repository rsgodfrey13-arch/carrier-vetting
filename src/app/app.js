"use strict";

const express = require("express");
const path = require("path");

const { internalRoutes } = require("../routes/internal");
const { publicRoutes } = require("../routes/public");
const { externalRoutes } = require("../routes/external/v1.routes");

function createApp() {
  const app = express();

  // Behind proxy on DigitalOcean
  app.set("trust proxy", 1);

  // Serve static from /static (Phase 1 stays correct)
  app.use(express.static(path.join(__dirname, "../../static")));

  // Parse JSON
  app.use(express.json());

  // Mount route groups
  app.use(publicRoutes());           // /contract/:token, /:dot, etc.
  app.use("/api", internalRoutes()); // session auth routes + UI APIs
  app.use("/api/v1", externalRoutes()); // API key auth + v1 API

  return app;
}

module.exports = { createApp };
