"use strict";

const express = require("express");

// These files will be created next (they can be empty placeholders for now)
const authRoutes = require("./auth.routes");
const carrierSearchRoutes = require("./carrierSearch.routes");
const carriersRoutes = require("./carriers.routes");
const myCarriersRoutes = require("./myCarriers.routes");
const contractsRoutes = require("./contracts.routes");
const insuranceRoutes = require("./insurance.routes");
const debugRoutes = require("./debug.routes");

function internalRoutes() {
  const router = express.Router();

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
