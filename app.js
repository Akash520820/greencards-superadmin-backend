const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const helmet = require("helmet");

const notFound = require("./shared/middleware/notFound.middleware");
const errorHandler = require("./shared/middleware/errorHandler.middleware");
const { apiLimiter } = require("./shared/middleware/rateLimiter.middleware");

const superAdminRouter = require("./routes/superAdmin.routes");
const staffRouter      = require("./routes/staff.routes");
const { receiveAuditEvent } = require("./controllers/auditEvent.controller");

const app = express();

// Trust reverse proxy (Render / API Gateway) for express-rate-limit and X-Forwarded-For
app.set("trust proxy", 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(compression());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(cookieParser());

// Health check endpoint (for Render & keep-alive pings - exempt from rate limiter)
app.get(["/health", "/api/v1/health"], (req, res) => {
  res.status(200).json({ status: "ok", service: "superadmin-backend", timestamp: new Date().toISOString() });
});

app.use(apiLimiter);

// SuperAdmin Microservice Routes
app.use("/api/v1/superadmin", superAdminRouter);
app.use("/api/v1/staff",      staffRouter);

// Internal endpoint — receives audit events from all other microservices.
// NOT exposed through the API gateway — service-to-service only.
app.post("/internal/audit", receiveAuditEvent);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
