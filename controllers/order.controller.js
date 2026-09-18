const crypto = require("crypto");
const mongoose = require("mongoose");
const asyncHandler = require("../shared/utils/asyncHandler");
const ApiError = require("../shared/utils/ApiError");
const ApiResponse = require("../shared/utils/ApiResponse");
const Order = require("../models/order.model");
const Cart = require("../models/cart.model");
const Product = require("../models/product.model");
const Coupon = require("../models/coupon.model");
const razorpayInstance = require("../shared/utils/razorpay");
const logger = require("../shared/utils/logger");
const { generateOrderInvoicePDF } = require("../shared/utils/invoice.service");
const SellerProfile = require("../models/sellerProfile.model");


const SHIPPING_PRICE = 50;

// MongoDB transactions can be aborted by the server with a transient error
// under normal contention (e.g. two checkouts touching the same product at
// once) — the driver expects the *caller* to retry in that case, it isn't a
// real failure. This wraps a session in exactly the retry loop MongoDB's own
// docs recommend, so callers just get a clean success/throw.
// https://www.mongodb.com/docs/manual/core/transactions-in-applications/#retry-transactions
const runInTransaction = async (fn) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

// Atomically decrements stock for one order line item, but only if enough
// stock is currently available — the availability check and the decrement
// happen as a single database operation, so two simultaneous checkouts for
// the same last unit can't both "see" it as available and both succeed.
// Returns the updated product doc, or null if there wasn't enough stock.
const atomicallyDecrementStock = async ({ productId, color, size, quantity, session }) => {
  if (color && size) {
    return Product.findOneAndUpdate(
      {
        _id: productId,
        isActive: true,
        colorVariants: {
          $elemMatch: { color, sizes: { $elemMatch: { size, stock: { $gte: quantity } } } },
        },
      },
      { $inc: { "colorVariants.$[c].sizes.$[s].stock": -quantity } },
      {
        arrayFilters: [{ "c.color": color }, { "s.size": size }],
        session,
        new: true,
      }
    );
  }

  return Product.findOneAndUpdate(
    { _id: productId, isActive: true, stock: { $gte: quantity } },
    { $inc: { stock: -quantity } },
    { session, new: true }
  );
};

const resolveOrderItems = async (req) => {
  const { productId, quantity, variant } = req.body;

  if (productId) {
    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      throw new ApiError(404, "Product not found");
    }

    return {
      items: [{ product, quantity: Number(quantity) || 1, variant: variant || {} }],
      cart: null,
    };
  }

  const cart = await Cart.findOne({ user: req.user._id }).populate("items.product");
  if (!cart || cart.items.length === 0) {
    throw new ApiError(400, "Cart is empty");
  }

  return { items: cart.items, cart };
};

const createRazorpayOrder = asyncHandler(async (req, res) => {
  const { items } = await resolveOrderItems(req);

  const itemsPrice = items.reduce((sum, item) => {
    const { sellingPrice } = item.product.getPriceForVariant(item.variant || {});
    return sum + sellingPrice * item.quantity;
  }, 0);

  const totalPrice = itemsPrice + SHIPPING_PRICE;

  const razorpayOrder = await razorpayInstance.orders.create({
    amount: Math.round(totalPrice * 100),
    currency: "INR",
    receipt: `receipt_${Date.now()}`,
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        razorpayOrderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        key: process.env.RAZORPAY_KEY_ID,
      },
      "Razorpay order created"
    )
  );
});

const placeOrder = asyncHandler(async (req, res) => {
  const {
    shippingAddress,
    paymentMethod,
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    idempotencyKey,
  } = req.body;

  if (!shippingAddress || !paymentMethod) {
    throw new ApiError(400, "Shipping address and payment method are required");
  }

  // Idempotent replay: if the client already successfully placed this exact
  // checkout attempt (e.g. a double-tap, or a retry after the response was
  // lost to a flaky connection), hand back the order that was already
  // created instead of charging/decrementing stock a second time.
  if (idempotencyKey) {
    const existingOrder = await Order.findOne({ idempotencyKey, user: req.user._id });
    if (existingOrder) {
      return res.status(200).json(new ApiResponse(200, existingOrder, "Order already placed"));
    }
  }

  if (paymentMethod === "razorpay") {
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      throw new ApiError(400, "Payment verification details are missing");
    }

    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");

    if (generatedSignature !== razorpaySignature) {
      throw new ApiError(400, "Payment verification failed");
    }
  }

  const { items, cart } = await resolveOrderItems(req);

  const order = await runInTransaction(async (session) => {
    const orderItems = [];
    let itemsPrice = 0;

    // Each line item's stock check-and-decrement is one atomic database
    // operation (see atomicallyDecrementStock), and all of them happen
    // inside a single transaction — so either every item's stock is
    // successfully reserved and the order is created, or none of it is.
    // A concurrent checkout racing for the same unit will simply fail this
    // atomic update for whichever request loses the race, instead of both
    // requests reading "in stock" and overselling.
    for (const item of items) {
      const product = item.product;

      if (!product || !product.isActive) {
        throw new ApiError(400, "Product no longer available");
      }

      const color = item.variant?.color;
      const size = item.variant?.size;
      const hasVariants = product.colorVariants.length > 0;

      if (hasVariants && (!color || !size)) {
        throw new ApiError(400, `Selected variant for ${product.name} is no longer available`);
      }

      const updatedProduct = await atomicallyDecrementStock({
        productId: product._id,
        color: hasVariants ? color : undefined,
        size: hasVariants ? size : undefined,
        quantity: item.quantity,
        session,
      });

      if (!updatedProduct) {
        throw new ApiError(400, `Insufficient stock for ${product.name}`);
      }

      const { sellingPrice } = product.getPriceForVariant(item.variant || {});
      const variantImages = product.getImagesForVariant(color);

      orderItems.push({
        product: product._id,
        seller: product.createdBy,
        name: product.name,
        image: variantImages[0],
        price: sellingPrice,
        quantity: item.quantity,
        variant: item.variant,
      });


      itemsPrice += sellingPrice * item.quantity;
    }

    const totalPrice = itemsPrice + SHIPPING_PRICE;

    const [createdOrder] = await Order.create(
      [
        {
          user: req.user._id,
          items: orderItems,
          shippingAddress,
          itemsPrice,
          shippingPrice: SHIPPING_PRICE,
          totalPrice,
          paymentMethod,
          paymentStatus: paymentMethod === "razorpay" ? "paid" : "pending",
          razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature,
          idempotencyKey,
        },
      ],
      { session }
    );

    if (cart) {
      cart.items = [];
      await cart.save({ session });
    }

    return createdOrder;
  });

  logger.info(`Order ${order._id} placed by user ${req.user._id} — total ₹${order.totalPrice}`);

  return res.status(201).json(new ApiResponse(201, order, "Order placed successfully"));
});

const razorpayWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];

  if (!signature) {
    throw new ApiError(400, "Missing webhook signature");
  }

  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(req.body)
    .digest("hex");

  if (signature !== expectedSignature) {
    throw new ApiError(400, "Invalid webhook signature");
  }

  const payload = JSON.parse(req.body.toString());
  const event = payload.event;

  if (event === "payment.captured") {
    const payment = payload.payload.payment.entity;
    const razorpayOrderId = payment.order_id;

    const existingOrder = await Order.findOne({ razorpayOrderId });

    if (existingOrder && existingOrder.paymentStatus !== "paid") {
      existingOrder.paymentStatus = "paid";
      existingOrder.razorpayPaymentId = payment.id;
      await existingOrder.save();
    }
  }

  return res.status(200).json({ received: true });
});

const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
  return res.status(200).json(new ApiResponse(200, orders, "Orders fetched successfully"));
});

const getOrderById = asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  const order = await Order.findById(orderId)
    .populate("user", "userName email")
    .populate("items.seller", "fullName storeName companyEmail email");
  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  if (order.user._id.toString() !== req.user._id.toString() && req.user.role !== "admin") {
    throw new ApiError(403, "Access denied");
  }

  return res.status(200).json(new ApiResponse(200, order, "Order fetched successfully"));
});

const getAllOrders = asyncHandler(async (req, res) => {
  const { status, sellerId, page = 1, limit = 20 } = req.query;

  const filter = {};
  if (status) filter.orderStatus = status;
  if (sellerId) filter["items.seller"] = sellerId;

  const skip = (Number(page) - 1) * Number(limit);

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate("user", "userName email")
      .populate("items.seller", "fullName storeName companyEmail email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Order.countDocuments(filter),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      { orders, pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) } },
      "Orders fetched successfully"
    )
  );
});

const updateOrderStatus = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { orderStatus } = req.body;

  const validStatuses = ["processing", "shipped", "delivered", "cancelled"];
  if (!validStatuses.includes(orderStatus)) {
    throw new ApiError(400, "Invalid order status");
  }

  const order = await Order.findById(orderId);
  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  order.orderStatus = orderStatus;
  if (orderStatus === "delivered") {
    order.deliveredAt = new Date();
  }

  await order.save();

  if (orderStatus === "delivered") {
    // Staged seller trust levels (Phase 8): bump each involved seller's
    // trust tier now that this order has actually completed. A seller
    // fulfilling multiple items in the same order only counts once here
    // per distinct seller.
    const sellerIds = [...new Set(order.items.map((item) => item.seller?.toString()).filter(Boolean))];
    await Promise.all(sellerIds.map((sellerId) => SellerProfile.recalculateTrustLevel(sellerId)));
  }

  return res.status(200).json(new ApiResponse(200, order, "Order status updated"));
});

const downloadOrderInvoice = asyncHandler(async (req, res) => {

  const { orderId } = req.params;
  const order = await Order.findById(orderId).populate("user", "userName email");
  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  if (order.user._id.toString() !== req.user._id.toString() && req.user.role !== "admin") {
    throw new ApiError(403, "Access denied");
  }

  const pdfBuffer = await generateOrderInvoicePDF(order);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=Invoice_${order._id}.pdf`);
  return res.status(200).send(pdfBuffer);
});

module.exports = {
  createRazorpayOrder,
  placeOrder,
  razorpayWebhook,
  getMyOrders,
  getOrderById,
  getAllOrders,
  updateOrderStatus,
  downloadOrderInvoice,
  atomicallyDecrementStock,
};
