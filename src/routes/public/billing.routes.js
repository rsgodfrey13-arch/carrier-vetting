"use strict";

const express = require("express");
const path = require("path");

const router = express.Router();

router.get("/billing", (req, res) => {
  res.sendFile(path.join(__dirname, "../../../static", "billing.html"));
});

module.exports = router;
