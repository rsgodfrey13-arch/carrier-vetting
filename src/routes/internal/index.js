"use strict";

const express = require("express");
const carrierSearchResultsRoutes = require("./carrierSearchResults.routes");
const authRoutes = require("./auth.routes");
const carrierSearchRoutes = require("./carrierSearch.routes");
const carriersRoutes = require("./carriers.routes");
const myCarriersRoutes = require("./myCarriers.routes");
const contractsRoutes = require("./contracts.routes");
const insuranceRoutes = require("./insurance.routes");
const meRoutes = require("./me.routes");
const debugRoutes = require("./debug.routes");

const healthInternalRoutes = require("./healthInternal.routes"); // router export
const { healthRoutes } = require("./health.routes"); // factory export

const publicCarriersRoutes = require("./publicCarriers.routes");

function internalRoutes({ pool } = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw new Error(
      "internalRoutes() requires a Postgres pool. Mount like: app.use('/api', internalRoutes({ pool }))"
    );
  }

  const router = express.Router();

  router.get("/_test500", (req, res) => {
  throw new Error("test crash");
});


  // Health first (no auth/session dependency)
  router.use(healthRoutes({ pool })); // GET /api/health
  router.use(healthInternalRoutes);   // GET /api/health-internal


  // Needs the Pool
  app.use("/api", internalRoutes({ pool }));


  // Existing internal routers
  router.use(authRoutes);
  router.use(carrierSearchRoutes);
  router.use(carrierSearchResultsRoutes);
  router.use(carriersRoutes);
  router.use(myCarriersRoutes);
  router.use(contractsRoutes);
  router.use(insuranceRoutes);
  router.use(debugRoutes);
  router.use(publicCarriersRoutes);

  return router;
}

module.exports = { internalRoutes };
