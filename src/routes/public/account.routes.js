"use strict";

const express = require("express");
const path = require("path");


// Do this when im ready for auth to be requred 
// const requireAuth = require("../internal/auth.middleware");


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
