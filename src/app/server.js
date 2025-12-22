"use strict";

require("../config/bootstrap"); // env bootstrap (GCP key write, etc.)

const session = require("express-session");
const { createApp } = require("./app");

const app = createApp();
const port = process.env.PORT || 3000;

// Session middleware (kept here so it runs before internal routes)
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
