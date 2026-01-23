"use strict";

const express = require("express");

function healthInternalRoutes() {
  const router = express.Router();

  router.get("/health-internal", (req, res) => {
    res.status(200).json({ status: "ok", layer: "internal" });
  });

  return router;
}

module.exports = { healthInternalRoutes };
