"use strict";

const express = require("express");

const authRoutes = require("./auth.routes");
const carrierSearchRoutes = require("./carrierSearch.routes");
const carriersRoutes = require("./carriers.routes");
const myCarriersRoutes = require("./myCarriers.routes");
const contractsRoutes = require("./contracts.routes");
const insuranceRoutes = require("./insurance.routes");
const debugRoutes = require("./debug.routes");

const healthInternalRoutes = require("./healthInternal.routes"); // router export
const { healthRoutes } = require("./health.routes"); // factory export

function internalRoutes({ pool } = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw new Error(
      "internalRoutes() requires a Postgres pool. Mount like: app.use('/api', internalRoutes({ pool }))"
    );
  }

  const router = express.Router();

  // Health first (no auth/session dependency)
  router.use(healthRoutes({ pool })); // GET /api/health
  router.use(healthInternalRoutes);   // GET /api/health-internal

  // Existing internal routers
  router.use(authRoutes);
  router.use(carrierSearchRoutes);
  router.use(carriersRoutes);
  router.use(myCarriersRoutes);
  router.use(contractsRoutes);
  router.use(insuranceRoutes);
  router.use(debugRoutes);

  return router;
}

module.exports = { internalRoutes };
