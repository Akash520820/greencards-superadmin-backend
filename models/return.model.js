const mongoose = require("mongoose");

// snapshot of one returned item — quantity may be less than what was originally ordered
const returnItemSchema = new mongoose.Schema(
  {
    product: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Product", 
      required: true 
    },
    name: { 
      type: String, 
      required: true 
    },
    image: { 
      type: String, 
      required: true 
    },
    price: { 
      type: Number, 
      required: true 
    }, // price at time of original order — refund basis
    quantity: { 
      type: Number, 
      required: true, 
      min: 1 
    },
    variant: {
      size: { type: String },
      color: { type: String },
    },
  },
  { _id: false }
);

const returnSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    items: [returnItemSchema],
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    refundAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["requested", "approved", "rejected", "picked_up", "refunded"],
      default: "requested",
    },
    refundMethod: {
      type: String,
      enum: ["cod", "razorpay"],
    },
    razorpayRefundId: { type: String },
    pickedUpAt: { type: Date },
    refundedAt: { type: Date },
    // who processed the pickup/refund — admin or a delivery staff account
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Return", returnSchema);