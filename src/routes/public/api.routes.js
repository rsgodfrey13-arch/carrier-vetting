"use strict";

const express = require("express");
const path = require("path");

const router = express.Router();

router.get("/api", (req, res) => {
  res.sendFile(path.join(__dirname, "../../../static", "api.html"));
});

module.exports = router;
