"use strict";

const express = require("express");
const path = require("path");
const session = require("express-session");

const { internalRoutes } = require("../routes/internal");
const { publicRoutes } = require("../routes/public");
const { externalV1Routes } = require("../routes/external/v1.routes");

function createApp() {
  const app = express();

  app.set("trust proxy", 1);

  const staticDir = path.join(__dirname, "../../static");

  // ✅ Serve static at root so "/" loads index.html
  app.use(express.static(staticDir));

  // ✅ Also serve the same static files under /static/*
  app.use("/static", express.static(staticDir));

  app.use(express.json());

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
  app.use("/api", internalRoutes());

  // External v1 APIs
  app.use("/api/v1", externalV1Routes());

  return app;
}

module.exports = { createApp };
