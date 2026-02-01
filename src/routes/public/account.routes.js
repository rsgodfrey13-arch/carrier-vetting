"use strict";

const express = require("express");
const path = require("path");

const router = express.Router();

router.get("/account", (req, res) => {
  res.sendFile(path.join(__dirname, "../../../static", "account.html"));
});

module.exports = router;
