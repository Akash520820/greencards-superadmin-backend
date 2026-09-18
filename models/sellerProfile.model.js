const mongoose = require("mongoose");

const bankAccountSchema = new mongoose.Schema(
  {
    accountHolderName: { 
      type: String, 
      required: true, 
      trim: true 
    },
    accountNumber: { 
      type: String, 
      required: true, 
      trim: true,
      validate: {
        validator: (v) => /^\d{9,18}$/.test(v), // Indian bank account numbers run 9–18 digits
        message: "Account number must be 9-18 digits",
      },
    },
    ifscCode: { 
      type: String, 
      required: true, 
      trim: true, 
      uppercase: true,
      validate: {
        validator: (v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), // e.g. HDFC0001234
        message: "IFSC code must be a valid 11-character code (e.g. HDFC0001234)",
      },
    },
    bankName: { 
      type: String, 
      required: true, 
      trim: true 
    },
    bankBranch: { 
      type: String, 
      trim: true,
      required: true 
    },
    accountType: {
      type: String,
      enum: ["savings", "current", "business"],
      default: "savings",
    },
    upiId: { 
      type: String, 
      trim: true,
      validate: {
        validator: (v) => !v || /^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/.test(v), // e.g. name@okhdfcbank
        message: "UPI ID must be in the form name@bank",
      },
    },
    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff", // which staff member verified/rejected these bank details
    },
    verifiedAt: {
      type: Date, // when verification happened
    },
  },
  { _id: false }
);

const sellerProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // one seller profile per user
      index: true,
    },
    businessName: {
      type: String,
      required: true,
      trim: true,
    },
    gstNumber: {
      type: String,
      required: [true, "GSTIN is required"],
      trim: true,
      uppercase: true,
      validate: {
        // Standard 15-character GSTIN format: 2-digit state code + 10-char PAN
        // + 1-digit entity number + 'Z' (fixed) + 1 checksum char.
        // This is a format check only — it confirms the number is
        // well-formed, not that it's a real, active registration with the
        // GST department. A real platform would follow this with a call to
        // the GSTN API (or a third-party KYC provider like Karza/Signzy) to
        // confirm the number actually exists and is active; that external
        // call is deliberately not wired up here.
        validator: (v) => /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z]{1}[A-Z\d]$/.test(v),
        message: "GSTIN must be a valid 15-character number (e.g. 22AAAAA0000A1Z5)",
      },
    },
    bankAccountDetails: {
      type: bankAccountSchema,
      required: true,
    },
    storeDescription: {
      type: String,
      trim: true,
    },
    storeLogo: {
      type: String, // Cloudinary URL
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "suspended"],
      default: "pending",
      index: true,
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
    commissionRate: {
      type: Number,
      default: 10, // percentage
      min: 0,
      max: 100,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
    },
    approvedAt: {
      type: Date,
    },
    // ---- Staged trust levels (Phase 8) ----
    // A brand-new seller starts with tighter limits that loosen
    // automatically as they build a track record — see
    // recalculateTrustLevel(), called from order.controller.js whenever
    // an order from this seller is marked "delivered".
    completedOrderCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    trustLevel: {
      type: String,
      enum: ["new", "growing", "established"],
      default: "new",
    },
    orderValueCap: {
      type: Number,
      default: 5000, // a "new" seller can't accept a single order above this value; null = uncapped
    },
    payoutDelayDays: {
      type: Number,
      default: 15, // how long completed-order funds are held before payout eligibility
    },
  },
  { timestamps: true }
);

// Trust tiers, keyed by completed (delivered) order count. Adjust these
// thresholds/limits to whatever risk tolerance actually fits — these are
// reasonable starting points, not a regulatory requirement.
const TRUST_TIERS = [
  { level: "established", minOrders: 50, orderValueCap: null, payoutDelayDays: 2 },
  { level: "growing", minOrders: 10, orderValueCap: 25000, payoutDelayDays: 7 },
  { level: "new", minOrders: 0, orderValueCap: 5000, payoutDelayDays: 15 },
];

// Call after an order from this seller is marked delivered. Increments
// their completed-order count and bumps trustLevel/orderValueCap/
// payoutDelayDays if they've crossed into a new tier. Never downgrades —
// trust earned isn't revoked just because order volume slows down.
sellerProfileSchema.statics.recalculateTrustLevel = async function (sellerUserId) {
  const sellerProfile = await this.findOne({ userId: sellerUserId });
  if (!sellerProfile) return null;

  sellerProfile.completedOrderCount += 1;

  const newTier = TRUST_TIERS.find((tier) => sellerProfile.completedOrderCount >= tier.minOrders);
  if (newTier && newTier.level !== sellerProfile.trustLevel) {
    sellerProfile.trustLevel = newTier.level;
    sellerProfile.orderValueCap = newTier.orderValueCap;
    sellerProfile.payoutDelayDays = newTier.payoutDelayDays;
  }

  await sellerProfile.save();
  return sellerProfile;
};

module.exports = mongoose.model("SellerProfile", sellerProfileSchema);