"use strict";

const express = require("express");
const path = require("path");

const router = express.Router();

router.get("/create-account", (req, res) => {
  res.sendFile(path.join(__dirname, "../../../static", "create-account.html"));
});

module.exports = router;
