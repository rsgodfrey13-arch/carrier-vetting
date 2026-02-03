"use strict";

const express = require("express");

// These files will be created next (can be placeholders for now).
const contractPublicRoutes = require("./contractPublic.routes");
const prettyDotRoutes = require("./prettyDot.routes");
const accountRoutes = require("./account.routes");
const healthzRoutes = require("./healthz.routes"); 
const trackRoutes = require("./track"); // adjust name/path if needed
const resetPasswordRoutes = require("./resetPassword.routes");

function publicRoutes() {
  const router = express.Router();
  router.use(contractPublicRoutes);
  router.use(healthzRoutes); 
  router.use(trackRoutes);   
  router.use(accountRoutes);
  router.use(resetPasswordRoutes);
  router.use(prettyDotRoutes);  // 👈 wildcard-ish routes last
  return router;
}

module.exports = { publicRoutes };
