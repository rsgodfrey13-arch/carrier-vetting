"use strict";

const express = require("express");

function healthExternalRoutes() {
  const router = express.Router();

  router.get("/health-external", (req, res) => {
    res.status(200).json({ status: "ok", layer: "external_v1" });
  });

  return router;
}

module.exports = { healthExternalRoutes };
