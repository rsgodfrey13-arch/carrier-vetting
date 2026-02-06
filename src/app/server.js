"use strict";

require("../config/bootstrap");

const { createClient } = require("redis");
const { createApp } = require("./app");

const port = process.env.PORT || 3000;

async function main() {
  let redisClient = null;

  if (process.env.REDIS_URL) {
    redisClient = createClient({ url: process.env.REDIS_URL });

    redisClient.on("error", (err) => {
      console.error("Redis error:", err);
    });

    await redisClient.connect();
    console.log("Redis connected");
  } else {
    console.warn("REDIS_URL not set — running without Redis session store");
  }

  const app = createApp({ redisClient });

  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
