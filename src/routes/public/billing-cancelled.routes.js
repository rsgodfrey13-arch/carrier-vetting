"use strict";

const express = require("express");
const path = require("path");

const router = express.Router();

router.get("/billing-cancelled", (req, res) => {
  res.sendFile(path.join(__dirname, "../../../static", "billing-cancelled.html"));
});

module.exports = router;
