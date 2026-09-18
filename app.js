const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const helmet = require("helmet");

const notFound = require("./shared/middleware/notFound.middleware");
const errorHandler = require("./shared/middleware/errorHandler.middleware");
const { apiLimiter } = require("./shared/middleware/rateLimiter.middleware");

const superAdminRouter = require("./routes/superAdmin.routes");
const staffRouter = require("./routes/staff.routes");

const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(compression());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(cookieParser());
app.use(apiLimiter);

// SuperAdmin Microservice Routes
app.use("/api/v1/superadmin", superAdminRouter);
app.use("/api/v1/staff", staffRouter);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
