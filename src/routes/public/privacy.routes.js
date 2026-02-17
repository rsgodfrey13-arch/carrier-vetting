"use strict";

const express = require("express");
const path = require("path");

const router = express.Router();

router.get("/privacy", (req, res) => {
  res.sendFile(path.join(__dirname, "../../../static", "privacy.html"));
});

module.exports = router;
