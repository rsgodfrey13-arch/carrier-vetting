"use strict";

const express = require("express");
const session = require("express-session");
const path = require("path");

function createApp() {
  const app = express();

  // If you're behind a proxy (DigitalOcean App Platform), this helps cookies work correctly
  app.set("trust proxy", 1);

  // Serve static files
  app.use(express.static(path.join(__dirname, "../../static")));

  // Parse JSON bodies for POST/PUT
  app.use(express.json());

  // Session middleware
  app.use(session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    }
  }));

  return app;
}

module.exports = { createApp };
