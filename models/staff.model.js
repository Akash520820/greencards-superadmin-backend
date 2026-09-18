const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { ALL_PERMISSIONS } = require("../shared/constants/permissions");

// Staff accounts (admin / superadmin) live in their own collection —
// deliberately never merged with the customer-facing `User` model. See
// AccessRequest for how new Staff documents actually get created (never
// directly): this schema itself has no public registration path.
const staffSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      unique: true,
      index: true,
      // e.g. STF-000001 — assigned in the pre-save hook below
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    companyEmail: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: function (v) {
          const domain = process.env.STAFF_EMAIL_DOMAIN;
          if (!domain) return true; // domain restriction not configured — allow any address
          return v.toLowerCase().endsWith(`@${domain.toLowerCase()}`);
        },
        message: () =>
          `Staff accounts must use a @${process.env.STAFF_EMAIL_DOMAIN || "<configured domain>"} email address`,
      },
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ["admin", "superadmin"], // never "user" or "seller" — those stay on the User model
      default: "admin",
    },
    // Just-in-time elevation (Phase 6). When set, `role` reverts to
    // `previousRole` automatically the next time this staff member makes
    // an authenticated request after this timestamp — see verifyStaffJWT.
    previousRole: {
      type: String,
      enum: ["admin", "superadmin", null],
      default: null,
    },
    roleExpiresAt: {
      type: Date,
      default: null,
    },
    // Fine-grained RBAC (Phase 3). Superadmin implicitly has every
    // permission regardless of this list — see hasPermission() below.
    permissions: {
      type: [String],
      enum: ALL_PERMISSIONS,
      default: [],
    },
    // MFA (Phase 5)
    mfaEnabled: {
      type: Boolean,
      default: false,
    },
    mfaSecret: {
      type: String,
      select: false, // TOTP secret — never returned by default
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff", // which staff member provisioned this account (null only for the bootstrap script)
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    refreshToken: {
      type: String,
      select: false,
    },
    lastLoginAt: {
      type: Date,
    },
    lastLoginIp: {
      type: String,
    },
  },
  { timestamps: true }
);

staffSchema.pre("save", async function () {
  if (this.isNew && !this.employeeId) {
    const count = await mongoose.model("Staff").countDocuments();
    this.employeeId = `STF-${String(count + 1).padStart(6, "0")}`;
  }

  if (!this.isModified("password")) return;
  if (this.$locals.skipPasswordHash) return;
  this.password = await bcrypt.hash(this.password, 10);
});

staffSchema.methods.isPasswordCorrect = async function (password) {
  return await bcrypt.compare(password, this.password);
};

// superadmin passes every permission check regardless of the permissions array
staffSchema.methods.hasPermission = function (permission) {
  if (this.role === "superadmin") return true;
  return this.permissions.includes(permission);
};

staffSchema.methods.generateAccessToken = function () {
  return jwt.sign(
    {
      _id: this._id,
      companyEmail: this.companyEmail,
      role: this.role,
      isStaff: true,
    },
    process.env.STAFF_ACCESS_TOKEN_SECRET,
    { expiresIn: process.env.STAFF_ACCESS_TOKEN_EXPIRY }
  );
};

staffSchema.methods.generateRefreshToken = function () {
  return jwt.sign({ _id: this._id, isStaff: true }, process.env.STAFF_REFRESH_TOKEN_SECRET, {
    expiresIn: process.env.STAFF_REFRESH_TOKEN_EXPIRY,
  });
};

module.exports = mongoose.model("Staff", staffSchema);
