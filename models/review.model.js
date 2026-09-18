const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    reportedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true 
    },
    reason: { 
      type: String, 
      required: true, 
      trim: true 
    },
    reportedAt: { 
      type: Date, 
      default: Date.now 
    },
  },
  { _id: false }
);

const sellerResponseSchema = new mongoose.Schema(
  {
    seller: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true 
    }, // the seller (User) who responded
    comment: { 
      type: String, 
      
      required: true, 
      
      trim: true 
    },
    respondedAt: { 
      type: Date, 
      default: Date.now 
    },
  }
  // no { _id: false } here — each reply gets its own _id so a specific one can be referenced later
);

const reviewSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true, // only allow reviews tied to an actual purchase
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      trim: true,
    },
    images: {
      type: [String], // Cloudinary URLs
      validate: {
        validator: (arr) => arr.length <= 5,
        message: "A review can have at most 5 images",
      },
      default: [],
    },
    helpfulVotes: {
      // users who marked this review helpful — array (not just a counter) so
      // we can enforce one vote per user and let them un-vote
      type: [mongoose.Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },
    reports: {
      type: [reportSchema],
      default: [],
    },
    moderationStatus: {
      type: String,
      enum: ["visible", "hidden"],
      default: "visible",
      index: true,
    },
    hiddenReason: {
      type: String,
      trim: true,
    },
    hiddenBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
    },
    hiddenAt: {
      type: Date,
    },
    sellerResponses: {
      // a thread — every reply the seller posts is kept, not overwritten
      type: [sellerResponseSchema],
      default: [],
    },
  },
  { timestamps: true }
);

// one review per user per product
reviewSchema.index({ product: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("Review", reviewSchema);