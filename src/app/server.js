"use strict";

require("../config/bootstrap");

const session = require("express-session");
const { createApp } = require("./app");

const app = createApp();
const port = process.env.PORT || 3000;

// Session middleware MUST be registered before internal routes execute.
// (Our app mounts routes inside createApp, but middleware order still matters.)
// To guarantee order, we install session here BEFORE any requests hit routes.
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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
