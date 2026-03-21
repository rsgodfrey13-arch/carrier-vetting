"use strict";

const express = require("express");
const path = require("path");

const router = express.Router();

router.get("/api-docs", (req, res) => {
  res.sendFile(path.join(__dirname, "../../../static", "api-docs.html"));
});

module.exports = router;
