const mongoose = require("mongoose");

// Append-only log of every sensitive staff action. Nothing in this app
// ever updates or deletes an AuditLog document — see auditLog.util.js,
// which is the only code path that writes to this collection.
const auditLogSchema = new mongoose.Schema(
  {
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
      index: true,
      // not required — a blocked/unauthenticated attempt (e.g. ip.blocked)
      // has no verified actor to attribute yet
    },
    actorEmail: {
      type: String, // denormalized snapshot — stays readable even if the Staff doc is later removed
      default: "unknown",
    },
    action: {
      type: String,
      required: true,
      index: true,
      // e.g. "staff.login", "staff.login_failed", "role.promote",
      // "permission.update", "access_request.create", "access_request.approve",
      // "seller.approve", "seller.reject", "bank.verify", "review.hide", "ip.blocked"
    },
    targetType: {
      type: String, // "Staff" | "User" | "SellerProfile" | "Review" | "AccessRequest" | etc.
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
    },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
