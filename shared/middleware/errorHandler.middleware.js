const logger = require("../utils/logger");

const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message;
  let errors = err.errors || [];

  // Mongoose schema validation failures (e.g. our bank-details format rules) —
  // these come from .save()/.create() without a statusCode, so without this
  // they'd otherwise fall through as an opaque 500
  if (err.name === "ValidationError" && !err.statusCode) {
    statusCode = 400;
    errors = Object.values(err.errors).map((e) => e.message);
    message = errors[0] || "Validation failed";
  }

  // Mongoose duplicate-key error (e.g. two SellerProfiles for the same userId)
  if (err.code === 11000 && !err.statusCode) {
    statusCode = 409;
    const field = Object.keys(err.keyPattern || {})[0] || "field";
    message = `A record with this ${field} already exists`;
  }

  // 4xx (bad auth, bad input, not found, etc.) are expected, routine client
  // outcomes — logging their full stack every time buries real bugs under
  // noise. Only genuine server-side errors (5xx) get the loud, full-trace log.
  if (statusCode >= 500) {
    logger.error(err.stack || err.message, { statusCode, path: req.originalUrl, method: req.method });
  } else {
    logger.info(`[${statusCode}] ${req.method} ${req.originalUrl} — ${message}`);
  }

  res.status(statusCode).json({
    success: false,
    message,
    errors,
    // no "stack" key here at all
  });
};

module.exports = errorHandler;