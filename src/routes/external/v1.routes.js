"use strict";

const express = require("express");

function externalV1Routes() {
  const router = express.Router();

  // ✅ Webhooks FIRST (no apiAuth)
  router.use(docupipeRoutes);

  // 🔒 Everything else still protected
  router.use(apiAuth);
  router.use(createApiV1(pool));

  return router;
}


const { apiAuth } = require("../../middleware/apiAuth");
const { pool } = require("../../db/pool");

// IMPORTANT: this must point to your v1.router.js (not the old root file)
const createApiV1 = require("./v1.router");

function externalV1Routes() {
  const router = express.Router();

  router.use(apiAuth);
  router.use(createApiV1(pool)); // <-- pool injected HERE

  return router;
}

module.exports = { externalV1Routes };
