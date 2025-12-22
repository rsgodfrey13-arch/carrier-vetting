"use strict";

const express = require("express");
const { apiAuth } = require("../../middleware/apiAuth");
const { pool } = require("../../db/pool");

// TEMP: keep using the existing root api-v1.js for now
const createApiV1 = require("../../../api-v1");

function externalRoutes() {
  const router = express.Router();

  // Protect all /api/v1 routes with API key auth
  router.use(apiAuth);

  // Mount the v1 API
  router.use(createApiV1(pool));

  return router;
}

module.exports = { externalRoutes };
