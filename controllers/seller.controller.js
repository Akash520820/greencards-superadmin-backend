const asyncHandler = require("../shared/utils/asyncHandler");
const ApiError = require("../shared/utils/ApiError");
const ApiResponse = require("../shared/utils/ApiResponse");
const SellerProfile = require("../models/sellerProfile.model");
const Product = require("../models/product.model");
const Order = require("../models/order.model");
const Review = require("../models/review.model");
const { uploadOnCloudinary } = require("../shared/utils/cloudinary");

// ---- Become-a-seller application (any logged-in user, role stays "user" until approved) ----
const applyForSeller = asyncHandler(async (req, res) => {
  const {
    businessName,
    gstNumber,
    storeDescription,
    accountHolderName,
    accountNumber,
    ifscCode,
    bankName,
    bankBranch,
    accountType,
    upiId,
  } = req.body;

  if (req.user.role === "seller") {
    throw new ApiError(409, "You are already an approved seller");
  }

  if (!businessName || !accountHolderName || !accountNumber || !ifscCode || !bankName || !bankBranch) {
    throw new ApiError(400, "Business name and complete bank account details (including branch) are required");
  }

  const bankAccountDetails = {
    accountHolderName,
    accountNumber,
    ifscCode,
    bankName,
    bankBranch,
    accountType,
    upiId,
  };

  const existingProfile = await SellerProfile.findOne({ userId: req.user._id });
  if (existingProfile) {
    if (existingProfile.status === "pending") {
      throw new ApiError(409, "You already have a pending seller application");
    }
    if (existingProfile.status === "approved") {
      throw new ApiError(409, "You are already an approved seller");
    }
    // rejected/suspended — allow re-applying by updating the existing profile
    existingProfile.businessName = businessName.trim();
    existingProfile.gstNumber = gstNumber;
    existingProfile.storeDescription = storeDescription;
    existingProfile.bankAccountDetails = bankAccountDetails;
    existingProfile.status = "pending";
    existingProfile.rejectionReason = undefined;

    if (req.file?.path) {
      const uploaded = await uploadOnCloudinary(req.file.path);
      if (uploaded?.url) existingProfile.storeLogo = uploaded.url;
    }

    await existingProfile.save();

    return res
      .status(200)
      .json(new ApiResponse(200, existingProfile, "Seller application re-submitted, pending review"));
  }

  let storeLogo;
  if (req.file?.path) {
    const uploaded = await uploadOnCloudinary(req.file.path);
    if (!uploaded?.url) {
      throw new ApiError(500, "Something went wrong while uploading the store logo");
    }
    storeLogo = uploaded.url;
  }

  const sellerProfile = await SellerProfile.create({
    userId: req.user._id,
    businessName: businessName.trim(),
    gstNumber,
    storeDescription,
    storeLogo,
    bankAccountDetails,
  });

  return res
    .status(201)
    .json(new ApiResponse(201, sellerProfile, "Seller application submitted, pending admin review"));
});

// ---- Check own seller application status ----
const getMySellerProfile = asyncHandler(async (req, res) => {
  const sellerProfile = await SellerProfile.findOne({ userId: req.user._id });
  if (!sellerProfile) {
    throw new ApiError(404, "No seller application found for this account");
  }

  return res.status(200).json(new ApiResponse(200, sellerProfile, "Seller profile fetched successfully"));
});

// ---- List only the products this seller owns (approved sellers only) ----
const getMyProducts = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [products, total] = await Promise.all([
    Product.find({ createdBy: req.user._id })
      .skip(skip)
      .limit(Number(limit))
      .sort({ createdAt: -1 }),
    Product.countDocuments({ createdBy: req.user._id }),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      { products, pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) } },
      "Your products fetched successfully"
    )
  );
});

// ---- Orders containing at least one of this seller's products ----
const getSellerOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const sellerProductIds = await Product.find({ createdBy: req.user._id }).distinct("_id");

  const filter = {
    $or: [
      { "items.seller": req.user._id },
      { "items.product": { $in: sellerProductIds } }
    ]
  };

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate("user", "userName fullName email")
      .skip(skip)
      .limit(Number(limit))
      .sort({ createdAt: -1 }),
    Order.countDocuments(filter),
  ]);

  // Trim each order down to just this seller's line items
  const sellerUserIdStr = req.user._id.toString();
  const sellerProductIdStrings = sellerProductIds.map((id) => id.toString());

  const scopedOrders = orders.map((order) => {
    const orderObj = order.toObject();
    orderObj.items = orderObj.items.filter(
      (item) =>
        (item.seller && item.seller.toString() === sellerUserIdStr) ||
        (item.product && sellerProductIdStrings.includes(item.product.toString()))
    );
    return orderObj;
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      { orders: scopedOrders, pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) } },
      "Seller orders fetched successfully"
    )
  );
});

// ---- Basic seller analytics: product count, order count, revenue from own products, platform commission ----
const getSellerAnalytics = asyncHandler(async (req, res) => {
  const sellerProductIds = await Product.find({ createdBy: req.user._id }).distinct("_id");
  const sellerProfile = await SellerProfile.findOne({ userId: req.user._id });
  const commissionRate = sellerProfile?.commissionRate ?? 10;

  const [totalProducts, revenueResult] = await Promise.all([
    Product.countDocuments({ createdBy: req.user._id }),
    Order.aggregate([
      { $match: { paymentStatus: "paid" } },
      { $unwind: "$items" },
      {
        $match: {
          $or: [
            { "items.seller": req.user._id },
            { "items.product": { $in: sellerProductIds } }
          ]
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          totalUnitsSold: { $sum: "$items.quantity" },
        },
      },
    ]),
  ]);

  const grossRevenue = revenueResult[0]?.totalRevenue || 0;
  const platformCommission = Math.round((grossRevenue * commissionRate) / 100);
  const netEarnings = grossRevenue - platformCommission;

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        totalProducts,
        totalRevenue: grossRevenue,
        commissionRate,
        platformCommission,
        netEarnings,
        totalUnitsSold: revenueResult[0]?.totalUnitsSold || 0,
      },
      "Seller analytics fetched successfully"
    )
  );
});

// ---- Update order item status by Seller ----
const updateSellerOrderItemStatus = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { itemStatus } = req.body;

  const validStatuses = ["processing", "shipped", "delivered", "cancelled"];
  if (!validStatuses.includes(itemStatus)) {
    throw new ApiError(400, "Invalid item status");
  }

  const sellerProductIds = await Product.find({ createdBy: req.user._id }).distinct("_id");
  const sellerProductIdStrings = sellerProductIds.map((id) => id.toString());

  const order = await Order.findById(orderId);
  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  let updatedCount = 0;
  order.items.forEach((item) => {
    const isSellerItem =
      (item.seller && item.seller.toString() === req.user._id.toString()) ||
      (item.product && sellerProductIdStrings.includes(item.product.toString()));

    if (isSellerItem) {
      item.itemStatus = itemStatus;
      updatedCount++;
    }
  });

  if (updatedCount === 0) {
    throw new ApiError(403, "You do not have items in this order to update");
  }

  await order.save();

  return res.status(200).json(new ApiResponse(200, order, "Item status updated successfully"));
});


// ---- All reviews left on THIS seller's products — the review "appears on their account" ----
const getMyProductReviews = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const sellerProductIds = await Product.find({ createdBy: req.user._id }).distinct("_id");

  const filter = { product: { $in: sellerProductIds }, moderationStatus: "visible" };

  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .populate("user", "userName avatar")
      .populate("product", "name slug")
      .skip(skip)
      .limit(Number(limit))
      .sort({ createdAt: -1 }),
    Review.countDocuments(filter),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      { reviews, pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) } },
      "Reviews on your products fetched successfully"
    )
  );
});

// ---- Seller responds to a review — only on a review for a product they created ----
// ---- Seller replies to a review — appends to the thread, does not overwrite previous replies ----
const respondToReview = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;
  const { comment } = req.body;

  if (!comment) {
    throw new ApiError(400, "A response comment is required");
  }

  const review = await Review.findById(reviewId).populate("product", "createdBy");
  if (!review) {
    throw new ApiError(404, "Review not found");
  }

  if (review.product.createdBy.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "You can only respond to reviews on products you created");
  }

  review.sellerResponses.push({
    seller: req.user._id,
    comment,
    respondedAt: new Date(),
  });
  await review.save();

  return res.status(201).json(new ApiResponse(201, review, "Reply added"));
});

// ---- Seller deletes one of their own replies from the thread ----
const deleteReviewResponse = asyncHandler(async (req, res) => {
  const { reviewId, responseId } = req.params;

  const review = await Review.findById(reviewId);
  if (!review) {
    throw new ApiError(404, "Review not found");
  }

  const reply = review.sellerResponses.id(responseId);
  if (!reply) {
    throw new ApiError(404, "Reply not found");
  }
  if (reply.seller.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "You can only delete your own replies");
  }

  review.sellerResponses.pull(responseId);
  await review.save();

  return res.status(200).json(new ApiResponse(200, review, "Reply deleted"));
});

module.exports = {
  applyForSeller,
  getMySellerProfile,
  getMyProducts,
  getSellerOrders,
  getSellerAnalytics,
  updateSellerOrderItemStatus,
  getMyProductReviews,
  respondToReview,
  deleteReviewResponse,
};