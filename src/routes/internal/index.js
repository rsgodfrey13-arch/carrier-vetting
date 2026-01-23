"use strict";

const express = require("express");

const authRoutes = require("./auth.routes");
const carrierSearchRoutes = require("./carrierSearch.routes");
const carriersRoutes = require("./carriers.routes");
const myCarriersRoutes = require("./myCarriers.routes");
const contractsRoutes = require("./contracts.routes");
const insuranceRoutes = require("./insurance.routes");
const debugRoutes = require("./debug.routes");

const healthInternalRoutes = require("./healthInternal.routes");
const { healthRoutes } = require("./health.routes"); // ✅ add

function internalRoutes({ pool }) { // ✅ accept deps
  const router = express.Router();

  // ✅ master first (so it always exists even if other routers change)
  router.use(healthRoutes({ pool }));        // /api/health
  router.use(healthInternalRoutes);          // /api/health-internal (your existing)

  // existing internal routers
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
