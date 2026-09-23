require("dotenv").config();
const app = require("./app");
const connectDB = require("./shared/db/index");
const logger = require("./shared/utils/logger");
const startKeepAlive = require("./shared/utils/keepAlive");

const PORT = process.env.PORT || process.env.SUPERADMIN_SERVICE_PORT || 5004;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      logger.info(`👑 SuperAdmin Microservice running on port ${PORT}`);
      console.log(`👑 SuperAdmin Microservice running on port ${PORT}`);
    });
    // Start keep-alive self-pinging on Render
    startKeepAlive();
  })
  .catch((err) => {
    logger.error("MongoDB connection failed in SuperAdmin Microservice:", err);
    process.exit(1);
  });
