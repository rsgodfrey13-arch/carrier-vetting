"use strict";

require("../config/bootstrap");

const { createApp } = require("./app");

const app = createApp();
const port = process.env.PORT || 3000;

const { externalV1Routes } = require("../routes/external/v1.routes");
app.use("/api/v1", externalV1Routes());


app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
