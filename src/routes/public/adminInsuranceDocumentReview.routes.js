"use strict";

const express = require("express");
const path = require("path");

const { requireAuth } = require("../../middleware/requireAuth");
const { loadCompanyContext, requireCompanyAdmin } = require("../../middleware/companyContext");

const router = express.Router();

router.get("/admin/insurance-exceptions", requireAuth, loadCompanyContext, requireCompanyAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "../../../static", "admin-insurance-document-review.html"));
});

router.get("/admin/insurance-document-review", requireAuth, loadCompanyContext, requireCompanyAdmin, (req, res) => {
  res.redirect(302, "/admin/insurance-exceptions");
});

module.exports = router;
