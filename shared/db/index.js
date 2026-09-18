const mongoose = require("mongoose");
const logger = require("../utils/logger");

const connectDB = async () => {
  try {
    const connectionInstance = await mongoose.connect(process.env.MONGODB_URI);
    logger.info(`MongoDB connected: ${connectionInstance.connection.host}`);
  } catch (error) {
    logger.error("MongoDB connection error", { error: error?.stack || error });
    process.exit(1);
  }
};

module.exports = connectDB;