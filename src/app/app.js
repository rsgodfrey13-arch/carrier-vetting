"use strict";

const express = require("express");
const path = require("path");
const session = require("express-session");

const { internalRoutes } = require("../routes/internal");
const { publicRoutes } = require("../routes/public");
const { externalV1Routes } = require("../routes/external/v1.routes");
const { logApiFailures } = require("../middleware/logApiFailures");
const { pool } = require("../db/pool");
const { errorHandler } = require("../middleware/errorHandler");
const RedisStore = require("connect-redis").default;


function createApp({ redisClient } = {}) {
  const app = express();

  // Behind Cloudflare / DO App Platform / any proxy
  app.set("trust proxy", 1);

  const staticDir = path.join(__dirname, "../../static");

  // ✅ Serve static at root so "/" loads index.html
  app.use(express.static(staticDir));

  // ✅ Also serve the same static files under /static/*
  app.use("/static", express.static(staticDir));

  // ✅ Parse incoming request bodies BEFORE routes
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false, limit: "10mb" }));

  // Sessions (used for internal routes)
  app.use(
    session({
      name: "cs.sid",
      secret: process.env.SESSION_SECRET || "dev-secret-change-me",
      resave: false,
      saveUninitialized: false,

      // ✅ Redis session store (premium production setup)
      store: redisClient
        ? new RedisStore({ client: redisClient, prefix: "cs:sess:" })
        : undefined, // allow local dev without Redis if you want

      rolling: true, // keep active users logged in
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
      },
    })
  );


  // ✅ Attach DB for any route that needs req.db (track uses it)
  app.use((req, res, next) => {
    req.db = pool;
    next();
  });

  // Log failures (400+ etc) into Postgres
  app.use(logApiFailures);

  // ✅ Public "site" routes at root (/:dot, /privacy, etc.)
  app.use(publicRoutes());


  // Internal session-based APIs
  app.use("/api", internalRoutes({ pool }));

  // External v1 APIs (webhooks + apiAuth protected routes)
  app.use("/api/v1", externalV1Routes());

  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
