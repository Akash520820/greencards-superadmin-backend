const AuditLog = require("../../models/auditLog.model");
const logger = require("./logger");

// Single entry point for writing to the audit trail. Fire-and-forget by
// design: a logging failure should never block or fail the actual
// request it's describing, so errors are caught and logged, not thrown.
//
// Usage: await logAudit(req.staff, "seller.approve", { type: "SellerProfile", id: sellerProfile._id }, { ... }, req)
const logAudit = async (actor, action, target = {}, metadata = {}, req = null) => {
  try {
    await AuditLog.create({
      actorId: actor?._id,
      actorEmail: actor?.companyEmail,
      action,
      targetType: target.type,
      targetId: target.id,
      metadata,
      ipAddress: req?.ip,
    });
  } catch (err) {
    logger.error("Failed to write audit log", { action, error: err?.message });
  }
};

module.exports = { logAudit };
