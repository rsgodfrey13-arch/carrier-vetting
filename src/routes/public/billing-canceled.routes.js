"use strict";

const express = require("express");
const path = require("path");

const router = express.Router();

router.get("/billing-canceled", (req, res) => {
  res.sendFile(path.join(__dirname, "../../../static", "billing-canceled.html"));
});

module.exports = router;
