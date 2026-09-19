const AuditLog = require("../models/auditLog.model");
const logger   = require("../shared/utils/logger");

/**
 * Internal endpoint — receives security events from all other microservices
 * and writes them to the append-only audit_logs collection.
 *
 * POST /internal/audit
 * Header: x-internal-secret: <INTERNAL_API_SECRET>
 *
 * Called by:
 *   - user-backend: ORDER_INTEGRITY_FAILURE, ORDER_CREATED, etc.
 *   - seller-backend: STOCK_RESERVED, STOCK_FAILED, etc.
 *   - admin-backend: STAFF_LOGIN, STAFF_PERMISSION_DENIED, etc.
 */
const receiveAuditEvent = async (req, res) => {
  // Verify internal secret — this endpoint is NOT exposed via API gateway
  if (req.headers["x-internal-secret"] !== process.env.INTERNAL_API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { action, performedBy, targetEntity, targetId, severity, metadata, ipAddress, userAgent } = req.body;

  if (!action) {
    return res.status(400).json({ error: "action is required" });
  }

  // Acknowledge immediately so the caller is never blocked by our write latency
  res.status(202).json({ queued: true });

  try {
    await AuditLog.create({
      action,
      performedBy,
      targetEntity,
      targetId,
      severity:  severity || "INFO",
      metadata:  metadata || {},
      ipAddress,
      userAgent,
    });
  } catch (err) {
    logger.error("receiveAuditEvent: failed to write audit log", {
      action,
      severity,
      error: err.message,
    });
  }
};

module.exports = { receiveAuditEvent };
