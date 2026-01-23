"use strict";

const express = require("express");

// These files will be created next (can be placeholders for now)
const contractPublicRoutes = require("./contractPublic.routes");
const prettyDotRoutes = require("./prettyDot.routes");
const healthzRoutes = require("./healthz.routes"); // 👈 ADD

function publicRoutes() {
  const router = express.Router();

  router.use(contractPublicRoutes);
  router.use(prettyDotRoutes);

  return router;
}

module.exports = { publicRoutes };
