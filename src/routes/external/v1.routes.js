"use strict";

const express = require("express");
const { apiAuth } = require("../../middleware/apiAuth");
const createApiV1 = require("./v1.router");

function externalV1Routes() {
  const router = express.Router();

  // protect all /api/v1 routes with API key auth
  router.use(apiAuth, createApiV1());

  return router;
}

module.exports = { externalV1Routes };
