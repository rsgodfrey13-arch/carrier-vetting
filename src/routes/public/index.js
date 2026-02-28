"use strict";

const express = require("express");

// These files will be created next (can be placeholders for now).
const contractPublicRoutes = require("./contractPublic.routes");
const prettyDotRoutes = require("./prettyDot.routes");
const accountRoutes = require("./account.routes");
const healthzRoutes = require("./healthz.routes"); 
const loginRoutes = require("./login.routes");
const acceptableRoutes = require("./acceptable-use.routes");
const activateRoutes = require("./activate-plan.routes");
const billingRoutes = require("./billing.routes");
const billingSuccessRoutes = require("./billing-success.routes");
const billingCanceledRoutes = require("./billing-canceled.routes");
const createRoutes = require("./create-account.routes");
const plansRoutes = require("./plans.routes");
const verifyRoutes = require("./verify-email.routes");
const demoRoutes = require("./demo.routes");
const dpaRoutes = require("./dpa.routes");
const faqRoutes = require("./faq.routes");
const helpRoutes = require("./help.routes");
const aboutRoutes = require("./about.routes");

// Add New Ones Here
const contactRoutes = require("./contact.routes");

const privacyRoutes = require("./privacy.routes");
const securityRoutes = require("./security.routes");
const termsRoutes = require("./terms.routes");
const trackRoutes = require("./track"); // adjust name/path if needed
const resetPasswordRoutes = require("./resetPassword.routes");

function publicRoutes() {
  const router = express.Router();
  router.use(contractPublicRoutes);
  router.use(healthzRoutes); 
  router.use(trackRoutes);   
  router.use(accountRoutes);
  router.use(resetPasswordRoutes);
  router.use(loginRoutes);
  router.use(acceptableRoutes);
  router.use(demoRoutes);
  router.use(dpaRoutes);
  router.use(faqRoutes);
  router.use(helpRoutes);
  router.use(aboutRoutes);
  
  // Add New Ones Here
  router.use(contactRoutes);
  router.use(billingSuccessRoutes);
  router.use(billingCanceledRoutes);  
  router.use(activateRoutes);
  router.use(billingRoutes);
  router.use(createRoutes);
  router.use(plansRoutes);
  router.use(verifyRoutes);
  router.use(privacyRoutes);
  router.use(securityRoutes);
  router.use(termsRoutes);
  router.use(prettyDotRoutes);  // 👈 wildcard-ish routes last
  return router;
}

module.exports = { publicRoutes };
