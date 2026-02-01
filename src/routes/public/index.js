"use strict";

const express = require("express");

// These files will be created next (can be placeholders for now).
const contractPublicRoutes = require("./contractPublic.routes");
const prettyDotRoutes = require("./prettyDot.routes");
const healthzRoutes = require("./healthz.routes"); 
const trackRoutes = require("./track"); // adjust name/path if needed

function publicRoutes() {
  const router = express.Router();
  router.use(contractPublicRoutes);
  router.use(prettyDotRoutes);
  router.use(healthzRoutes); 
  router.use(trackRoutes);   // ✅ THIS IS THE MISSING PIECE
  return router;
}

module.exports = { publicRoutes };
