"use strict";

const express = require("express");

const contractPublicRoutes = require("./contractPublic.routes");
const prettyDotRoutes = require("./prettyDot.routes");
const healthzRoutes = require("./healthz.routes");
const trackRoutes = require("./track");
const accountRoutes = require("./account.routes"); // 👈 ADD THIS

function publicRoutes() {
  const router = express.Router();

  router.use(contractPublicRoutes);
  router.use(prettyDotRoutes);
  router.use(healthzRoutes);
  router.use(trackRoutes);
  router.use(accountRoutes); // 👈 ADD THIS

  return router;
}

module.exports = { publicRoutes };
