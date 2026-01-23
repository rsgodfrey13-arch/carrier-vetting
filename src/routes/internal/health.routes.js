"use strict";

const express = require("express");
const axios = require("axios");
const https = require("https");

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function healthRoutes({ pool }) {
  const router = express.Router();

  router.get("/health", async (req, res) => {
    const started = Date.now();
    const out = { status: "ok", checks: {}, ms: {} };

    try {
      // Public
      {
        const t = Date.now();
        await axios.get("https://carriershark.com/healthz", { timeout: 2000 });
        out.checks.public = true;
        out.ms.public = Date.now() - t;
      }

      // Internal router alive
      {
        const t = Date.now();
        await axios.get("https://carriershark.com/api/health-internal", { timeout: 2000 });
        out.checks.internal = true;
        out.ms.internal = Date.now() - t;
      }

      // External v1 router alive (no auth)
      {
        const t = Date.now();
        await axios.get("https://carriershark.com/api/v1/health-external", { timeout: 2000 });
        out.checks.external_v1 = true;
        out.ms.external_v1 = Date.now() - t;
      }

      // Postgres
      {
        const t = Date.now();
        await pool.query("SELECT 1");
        out.checks.postgres = true;
        out.ms.postgres = Date.now() - t;
      }

      // NiFi
      {
        const t = Date.now();
        await axios.get("https://129.212.189.13:8443/nifi-api/system-diagnostics", {
          timeout: 2000,
          httpsAgent,
        });
        out.checks.nifi = true;
        out.ms.nifi = Date.now() - t;
      }

      out.ms.total = Date.now() - started;
      return res.status(200).json(out);
    } catch (err) {
      out.status = "error";
      out.error = err.message;
      out.ms.total = Date.now() - started;
      return res.status(500).json(out);
    }
  });

  return router;
}

module.exports = { healthRoutes };
