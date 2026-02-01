"use strict";

const express = require("express");
const path = require("path");

function accountRoutes() {
  const router = express.Router();

  router.get("/account", (req, res) => {
    res.sendFile(
      path.join(__dirname, "../../../static/account.html")
    );
  });

  return router;
}

module.exports = accountRoutes;
