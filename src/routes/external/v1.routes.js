"use strict";

const express = require("express");
const { apiAuth } = require("../../middleware/apiAuth");
const { pool } = require("../../db/pool");
const createApiV1 = require("./v1.router");

// IMPORT YOUR DOCUPIPE ROUTES
const docupipeRoutes = require("./docupipe.routes"); // <-- path may differ, see note below

function externalV1Routes() {
  const router = express.Router();

  // Webhook FIRST (no apiAuth)
  router.use(docupipeRoutes);

  // Everything else protected
  router.use(apiAuth);
  router.use(createApiV1(pool));

  return router;
}

module.exports = { externalV1Routes };
