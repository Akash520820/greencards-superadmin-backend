const winston = require("winston");

// Structured logging in production (JSON, one line per event — greppable and
// ready for a log aggregator like CloudWatch/Datadog/Better Stack), plain
// colorized output in development for readability. Replaces bare
// console.log/console.error calls used throughout the app.
const isProduction = process.env.NODE_ENV === "production";

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  format: isProduction
    ? winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json())
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: "HH:mm:ss" }),
        winston.format.printf(({ timestamp, level, message, stack }) => `${timestamp} ${level}: ${stack || message}`)
      ),
  defaultMeta: { service: "ecommerce-backend" },
  transports: [new winston.transports.Console()],
  // Never let a logging failure crash the process
  exitOnError: false,
});

module.exports = logger;
