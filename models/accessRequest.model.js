const mongoose = require("mongoose");

// A request to either (a) create a brand-new staff account, or (b) extend
// an existing staff member's elevated role for a limited time (JIT
// elevation, Phase 6). Nothing in this app creates or promotes a Staff
// document directly — every path runs through this model, so every
// grant of access has a requester, a reason, and one or more approvers
// on record.
const approvalSchema = new mongoose.Schema(
  {
    approverId: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", required: true },
    decision: { type: String, enum: ["approved", "rejected"], required: true },
    decidedAt: { type: Date, default: Date.now },
    comment: { type: String, trim: true },
  },
  { _id: false }
);

const accessRequestSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["create_staff", "extend_elevation"],
      required: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
    },
    // ---- for type: "create_staff" ----
    targetEmail: { type: String, lowercase: true, trim: true },
    targetFullName: { type: String, trim: true },
    requestedRole: { type: String, enum: ["admin", "superadmin"] },
    requestedPermissions: { type: [String], default: [] },

    // ---- for type: "extend_elevation" ----
    targetStaffId: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },
    durationHours: { type: Number, min: 1, max: 720 }, // JIT window — max 30 days

    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    // Superadmin grants (create_staff with role "superadmin", or any
    // extend_elevation to "superadmin") require TWO distinct approvals —
    // the four-eyes principle. Everything else needs just one.
    requiredApprovals: {
      type: Number,
      default: 1,
    },
    approvals: {
      type: [approvalSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    // set once the request is fully approved and actually resolved into a
    // Staff document change — kept separate from `status` so we can tell
    // "approved but not yet applied" apart from "fully done", though in
    // practice resolution happens synchronously on the final approval.
    resolvedAt: { type: Date },
    resultingStaffId: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },

    // temporary credential handed back to the requester exactly once,
    // when a create_staff request is approved — see resolveApprovedRequest
    generatedTempPassword: { type: String, select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AccessRequest", accessRequestSchema);
