"use strict";

const express = require("express");
const path = require("path");

const router = express.Router();

router.get("/acceptable-use", (req, res) => {
  res.sendFile(path.join(__dirname, "../../../static", "acceptable-use.html"));
});

module.exports = router;
