"use strict";

const express = require("express");
const path = require("path");

const router = express.Router();

/**
 * PRETTY URL: /12345 → serve carrier.html
 * This must be AFTER /api/* routes (it is, because /api is mounted separately)
 */
router.get("/:dot(\\d+)", (req, res) => {
  res.sendFile(path.join(__dirname, "../../../static", "carrier.html"));
});

module.exports = router;
