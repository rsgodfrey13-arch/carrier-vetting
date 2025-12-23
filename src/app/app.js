"use strict";

const express = require("express");
const path = require("path");
const session = require("express-session");


const { internalRoutes } = require("../routes/internal");
const { publicRoutes } = require("../routes/public");
//const { externalRoutes } = require("../routes/external/v1.routes"); // Old v1 route reference
const { externalV1Routes } = require("../routes/external/v1.routes");



function createApp() {
  const app = express();

  // If you're behind a proxy (DigitalOcean App Platform)
  app.set("trust proxy", 1);

  // Serve static files from /static (your Phase 1 move)
  const staticDir = path.join(__dirname, "../../static");
  app.use("/static", express.static(staticDir));
  ;

  // Parse JSON bodies
  app.use(express.json());

    app.use(session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    }
  }));


  // Public (no-auth) routes first (contract token pages, /:dot, etc.)
  app.use(publicRoutes());

  // Internal (session-based) APIs mounted under /api
  app.use("/api", internalRoutes());

  // External API key routes (we’ll enable after v1.routes.js exists)
   app.use("/api/v1", externalV1Routes());

  return app;
}

module.exports = { createApp };
