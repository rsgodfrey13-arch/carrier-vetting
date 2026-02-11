"use strict";

require("./instrument");
require("../config/bootstrap");

const { createClient } = require("redis");
const { createApp } = require("./app");

const port = process.env.PORT || 3000;

async function main() {
  let redisClient = null;

  if (process.env.REDIS_URL) {
    redisClient = createClient({
      url: process.env.REDIS_URL,

      // Prevent idle connection timeouts (common around ~5 minutes)
      pingInterval: 60_000, // 60s

      socket: {
        keepAlive: true,

        // Reconnect with backoff (ms). Return false to stop retrying.
        reconnectStrategy: (retries) => {
          // retries starts at 0; keep it simple and bounded
          return Math.min((retries + 1) * 200, 2000);
        },
      },
    });

    redisClient.on("error", (err) => {
      console.error("Redis error:", err);
    });

    redisClient.on("reconnecting", () => {
      console.warn("Redis reconnecting...");
    });

    redisClient.on("ready", () => {
      console.log("Redis ready");
    });

    redisClient.on("end", () => {
      console.warn("Redis connection closed");
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
