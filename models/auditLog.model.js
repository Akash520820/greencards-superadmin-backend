const mongoose = require("mongoose");

// ─── Append-Only Audit Log ────────────────────────────────────────────────────
// This collection lives on the greencard-superadmin Atlas cluster — completely
// isolated from all other clusters.
//
// Security guarantees:
//   1. Even if an attacker fully compromises the greencard-user or
//      greencard-seller cluster, they have NO network path to this cluster.
//   2. The MongoDB collection validation rule (set in Atlas UI) rejects any
//      update or delete at the database engine level.
//   3. The pre-hooks below enforce the same rule at the Mongoose/application
//      level as a second line of defense.
//   4. The svc_superadmin Atlas DB user only has readWrite on superadmin_db —
//      it cannot drop collections or modify validation rules.
const auditLogSchema = new mongoose.Schema(
  {
    // What happened — use dot-notation strings for easy querying
    // e.g. "staff.login", "order.integrity_failure", "stock.reserved"
    action: {
      type:     String,
      required: true,
      index:    true,
    },

    // Who performed the action — publicId (usr_, stf_, sel_ prefix string)
    // not required because blocked/unauthenticated events have no verified actor
    performedBy: {
      type:  String,
      index: true,
    },

    // What entity was affected
    targetEntity: { type: String },  // e.g. "order", "user", "product", "staff"
    targetId:     { type: String },  // publicId of the affected entity

    severity: {
      type:    String,
      enum:    ["INFO", "WARNING", "CRITICAL"],
      default: "INFO",
      index:   true,
    },

    // Arbitrary structured context — JSON-serializable
    metadata: {
      type:    mongoose.Schema.Types.Mixed,
      default: {},
    },

    ipAddress: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ severity: 1, createdAt: -1 });

// ─── Append-Only Enforcement (Mongoose layer) ────────────────────────────────
// These pre-hooks throw if any mutation operation is attempted.
// Combined with the MongoDB Atlas collection validation rule, this gives
// two independent layers of append-only enforcement.
const BLOCKED_OPS = [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
  "findOneAndReplace",
];

BLOCKED_OPS.forEach((op) => {
  auditLogSchema.pre(op, function () {
    throw new Error(
      `[AuditLog] ${op} is not permitted — audit_logs is append-only. ` +
        "To correct an error, create a new corrective entry instead."
    );
  });
});

module.exports = mongoose.model("AuditLog", auditLogSchema);
