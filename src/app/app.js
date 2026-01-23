"use strict";

const express = require("express");
const path = require("path");
const session = require("express-session");

const { internalRoutes } = require("../routes/internal");
const { publicRoutes } = require("../routes/public");
const { externalV1Routes } = require("../routes/external/v1.routes");
const { logApiFailures } = require("../middleware/logApiFailures");


function createApp() {
  const app = express();

  // Behind Cloudflare / DO App Platform / any proxy
  app.set("trust proxy", 1);

  const staticDir = path.join(__dirname, "../../static");

  // ✅ Serve static at root so "/" loads index.html
  app.use(express.static(staticDir));

  // ✅ Also serve the same static files under /static/*
  app.use("/static", express.static(staticDir));

  // ✅ Parse incoming request bodies BEFORE routes
  // Increase limit for webhook payloads
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false, limit: "10mb" }));

  // Sessions (used for internal routes)
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "dev-secret-change-me",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
    })
  );

  // Public routes (/:dot, /privacy, etc.)
  app.use(publicRoutes());

  // Internal session-based APIs
  const { pool } = require("../db/pool");
  app.use("/api", internalRoutes({ pool }));

  // External v1 APIs (webhooks + apiAuth protected routes)
  app.use("/api/v1", externalV1Routes());

  // Log failures (400+ or whatever threshold you set) into Postgres
  app.use(logApiFailures);

  return app;
}

module.exports = { createApp };
