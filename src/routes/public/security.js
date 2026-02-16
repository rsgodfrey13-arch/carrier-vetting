"use strict";

const express = require("express");
const path = require("path");

const router = express.Router();

router.get("/security", (req, res) => {
  res.sendFile(path.join(__dirname, "../../../security", "acceptable-use.html"));
});

module.exports = router;
