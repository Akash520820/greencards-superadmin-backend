require("dotenv").config();
const app = require("./app");
const connectDB = require("./shared/db/index");
const logger = require("./shared/utils/logger");
const startKeepAlive = require("./shared/utils/keepAlive");
const mongoose = require("mongoose");

// ─── Fail-fast: required env vars ────────────────────────────────────────────
const hasAccessSecret =
  process.env.SUPERADMIN_ACCESS_TOKEN_SECRET ||
  process.env.STAFF_ACCESS_TOKEN_SECRET ||
  process.env.ACCESS_TOKEN_SECRET;
const hasRefreshSecret =
  process.env.SUPERADMIN_REFRESH_TOKEN_SECRET ||
  process.env.STAFF_REFRESH_TOKEN_SECRET ||
  process.env.REFRESH_TOKEN_SECRET;

const missing = [];
if (!process.env.MONGODB_URI) missing.push("MONGODB_URI");
if (!hasAccessSecret) missing.push("SUPERADMIN_ACCESS_TOKEN_SECRET (or STAFF_ACCESS_TOKEN_SECRET)");
if (!hasRefreshSecret) missing.push("SUPERADMIN_REFRESH_TOKEN_SECRET (or STAFF_REFRESH_TOKEN_SECRET)");

if (missing.length > 0) {
  console.error(`[superadmin-backend] Missing required environment variables: ${missing.join(", ")}`);
  console.error("Set them in your .env file (local) or Render Dashboard (production).");
  process.exit(1);
}

const PORT = process.env.PORT || process.env.SUPERADMIN_SERVICE_PORT || 5004;

connectDB()
  .then(() => {
    // ─── MongoDB reconnect handlers ───────────────────────────────────────────
    mongoose.connection.on("error", (err) => {
      logger.error("MongoDB connection error (after startup):", err);
    });
    mongoose.connection.on("disconnected", () => {
      logger.warn("MongoDB disconnected — Mongoose will auto-reconnect");
    });
    mongoose.connection.on("reconnected", () => {
      logger.info("MongoDB reconnected");
    });

    const server = app.listen(PORT, () => {
      logger.info(`👑 SuperAdmin Microservice running on port ${PORT}`);
      console.log(`👑 SuperAdmin Microservice running on port ${PORT}`);
    });

    // Start keep-alive self-pinging on Render
    startKeepAlive();

    // ─── Graceful shutdown ────────────────────────────────────────────────────
    const shutdown = (signal) => {
      logger.info(`${signal} received — shutting down gracefully`);
      server.close(() => {
        logger.info("HTTP server closed");
        mongoose.connection.close(false, () => {
          logger.info("MongoDB connection closed");
          process.exit(0);
        });
      });
      setTimeout(() => {
        logger.error("Graceful shutdown timed out — forcing exit");
        process.exit(1);
      }, 10_000);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT",  () => shutdown("SIGINT"));
  })
  .catch((err) => {
    logger.error("MongoDB connection failed in SuperAdmin Microservice:", err);
    process.exit(1);
  });
