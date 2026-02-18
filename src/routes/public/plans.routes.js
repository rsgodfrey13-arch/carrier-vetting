"use strict";

const express = require("express");
const path = require("path");

const router = express.Router();

router.get("/plans", (req, res) => {
  res.sendFile(path.join(__dirname, "../../../static", "plans.html"));
});

module.exports = router;
