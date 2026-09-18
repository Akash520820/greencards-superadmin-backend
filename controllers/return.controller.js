const asyncHandler = require("../shared/utils/asyncHandler");
const ApiError = require("../shared/utils/ApiError");
const ApiResponse = require("../shared/utils/ApiResponse");
const Return = require("../models/return.model");
const Order = require("../models/order.model");
const razorpayInstance = require("../shared/utils/razorpay");
const Product = require("../models/product.model");

// ---- USER: request a return for specific item(s) from a delivered order ----
const createReturn = asyncHandler(async (req, res) => {
  const { orderId, items, reason } = req.body;

  if (!orderId || !items || items.length === 0 || !reason) {
    throw new ApiError(400, "Order, at least one item, and reason are required");
  }

  const order = await Order.findOne({ _id: orderId, user: req.user._id });
  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  if (order.orderStatus !== "delivered") {
    throw new ApiError(400, "Only delivered orders can be returned");
  }

  const daysSinceDelivery = (Date.now() - order.deliveredAt) / (1000 * 60 * 60 * 24);
  if (daysSinceDelivery > 7) {
    throw new ApiError(400, "Return window has expired (7 days from delivery)");
  }

  const returnItems = [];
  let refundAmount = 0;

  for (const reqItem of items) {
    const orderedItem = order.items.find(
      (oi) =>
        oi.product.toString() === reqItem.productId &&
        (oi.variant?.color || null) === (reqItem.variant?.color || null) &&
        (oi.variant?.size || null) === (reqItem.variant?.size || null)
    );

    if (!orderedItem) {
      throw new ApiError(400, "One or more items were not part of this order");
    }
    if (reqItem.quantity > orderedItem.quantity) {
      throw new ApiError(400, `Cannot return more than ${orderedItem.quantity} of ${orderedItem.name}`);
    }

    returnItems.push({
      product: orderedItem.product,
      name: orderedItem.name,
      image: orderedItem.image,
      price: orderedItem.price,
      quantity: reqItem.quantity,
      variant: orderedItem.variant,
    });

    refundAmount += orderedItem.price * reqItem.quantity;
  }

  const existingReturn = await Return.findOne({ order: orderId, status: { $ne: "rejected" } });
  if (existingReturn) {
    throw new ApiError(409, "A return request already exists for this order");
  }

  const returnRequest = await Return.create({
    order: orderId,
    user: req.user._id,
    items: returnItems,
    reason,
    refundAmount,
  });

  return res.status(201).json(new ApiResponse(201, returnRequest, "Return requested successfully"));
});

// ---- USER: view own return requests ----
const getMyReturns = asyncHandler(async (req, res) => {
  const returns = await Return.find({ user: req.user._id }).sort({ createdAt: -1 });
  return res.status(200).json(new ApiResponse(200, returns, "Returns fetched successfully"));
});

// ---- USER/ADMIN: view a single return ----
const getReturnById = asyncHandler(async (req, res) => {
  const { returnId } = req.params;

  const returnRequest = await Return.findById(returnId).populate("user", "userName email");
  if (!returnRequest) {
    throw new ApiError(404, "Return request not found");
  }

  if (returnRequest.user._id.toString() !== req.user._id.toString() && req.user.role !== "admin") {
    throw new ApiError(403, "Access denied");
  }

  return res.status(200).json(new ApiResponse(200, returnRequest, "Return fetched successfully"));
});

// ---- ADMIN: list all return requests ----
const getAllReturns = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;

  const filter = {};
  if (status) filter.status = status;

  const skip = (Number(page) - 1) * Number(limit);

  const [returns, total] = await Promise.all([
    Return.find(filter).populate("user", "userName email").sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Return.countDocuments(filter),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      { returns, pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) } },
      "Returns fetched successfully"
    )
  );
});

// ---- ADMIN: approve or reject a return request ----
const reviewReturn = asyncHandler(async (req, res) => {
  const { returnId } = req.params;
  const { status } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    throw new ApiError(400, "Status must be 'approved' or 'rejected'");
  }

  const returnRequest = await Return.findById(returnId);
  if (!returnRequest) {
    throw new ApiError(404, "Return request not found");
  }

  if (returnRequest.status !== "requested") {
    throw new ApiError(400, "This return request has already been reviewed");
  }

  returnRequest.status = status;
  await returnRequest.save();

  return res.status(200).json(new ApiResponse(200, returnRequest, `Return ${status}`));
});

// ---- DELIVERY/ADMIN: mark item picked up from customer — restocks inventory ----
const markPickedUp = asyncHandler(async (req, res) => {
  const { returnId } = req.params;

  const returnRequest = await Return.findById(returnId);
  if (!returnRequest) {
    throw new ApiError(404, "Return request not found");
  }

  if (returnRequest.status !== "approved") {
    throw new ApiError(400, "Return must be approved before pickup");
  }

  for (const item of returnRequest.items) {
    const product = await Product.findById(item.product);
    if (!product) continue;

    if (product.colorVariants.length > 0) {
      const { sizeVariant } = product.findVariant({ color: item.variant?.color, size: item.variant?.size });
      if (sizeVariant) {
        sizeVariant.stock += item.quantity;
      }
    } else {
      product.stock += item.quantity;
    }

    await product.save();
  }

  returnRequest.status = "picked_up";
  returnRequest.pickedUpAt = new Date();
  returnRequest.processedBy = req.user._id;
  await returnRequest.save();

  return res.status(200).json(new ApiResponse(200, returnRequest, "Item marked as picked up and stock restored"));
});

// ---- DELIVERY/ADMIN: process the refund, choosing the method at pickup ----
const processRefund = asyncHandler(async (req, res) => {
  const { returnId } = req.params;
  const { refundMethod } = req.body;

  if (!["cod", "razorpay"].includes(refundMethod)) {
    throw new ApiError(400, "A valid refund method (cod or razorpay) is required");
  }

  const returnRequest = await Return.findById(returnId).populate("order");
  if (!returnRequest) {
    throw new ApiError(404, "Return request not found");
  }

  if (returnRequest.status !== "picked_up") {
    throw new ApiError(400, "Item must be picked up before processing refund");
  }

  const order = returnRequest.order;

  if (refundMethod === "razorpay") {
    if (order.paymentMethod !== "razorpay" || !order.razorpayPaymentId) {
      throw new ApiError(400, "This order was not paid online — choose cod refund instead");
    }

    try {
      const refund = await razorpayInstance.payments.refund(order.razorpayPaymentId, {
        amount: Math.round(returnRequest.refundAmount * 100),
      });
      returnRequest.razorpayRefundId = refund.id;
    } catch (error) {
      throw new ApiError(500, "Refund via Razorpay failed. Please try again or process as cash refund.");
    }
  }

  returnRequest.refundMethod = refundMethod;
  returnRequest.status = "refunded";
  returnRequest.refundedAt = new Date();
  returnRequest.processedBy = req.user._id;
  await returnRequest.save();

  return res.status(200).json(new ApiResponse(200, returnRequest, "Refund processed successfully"));
});

module.exports = {
  createReturn,
  getMyReturns,
  getReturnById,
  getAllReturns,
  reviewReturn,
  markPickedUp,
  processRefund,
};