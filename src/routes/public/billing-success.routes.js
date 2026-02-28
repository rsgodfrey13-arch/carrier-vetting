"use strict";

const express = require("express");
const path = require("path");

const router = express.Router();

router.get("/billing-success", (req, res) => {
  res.sendFile(path.join(__dirname, "../../../static", "billing-success.html"));
});

module.exports = router;
