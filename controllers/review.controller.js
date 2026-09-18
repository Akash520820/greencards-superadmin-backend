const asyncHandler = require("../shared/utils/asyncHandler");
const ApiError = require("../shared/utils/ApiError");
const ApiResponse = require("../shared/utils/ApiResponse");
const Review = require("../models/review.model");
const Order = require("../models/order.model");
const Product = require("../models/product.model");
const { uploadOnCloudinary } = require("../shared/utils/cloudinary");

// recalculates and saves a product's average rating + count
const recalculateProductRatings = async (productId) => {
  const stats = await Review.aggregate([
    { $match: { product: productId, moderationStatus: "visible" } }, // hidden reviews don't count toward the public rating
    {
      $group: {
        _id: "$product",
        average: { $avg: "$rating" },
        count: { $sum: 1 },
      },
    },
  ]);

  await Product.findByIdAndUpdate(productId, {
    "ratings.average": stats[0]?.average || 0,
    "ratings.count": stats[0]?.count || 0,
  });
};

// ---- CREATE a review — only for products the user actually purchased & received ----
const createReview = asyncHandler(async (req, res) => {
  const { productId, orderId, rating, comment } = req.body;

  if (!productId || !orderId || !rating) {
    throw new ApiError(400, "Product, order, and rating are required");
  }

  const order = await Order.findOne({ _id: orderId, user: req.user._id });
  if (!order) {
    throw new ApiError(404, "Order not found");
  }
  if (order.orderStatus !== "delivered") {
    throw new ApiError(400, "You can only review products from delivered orders");
  }

  const purchasedProduct = order.items.find((item) => item.product.toString() === productId);
  if (!purchasedProduct) {
    throw new ApiError(400, "This product was not part of the given order");
  }

  const existingReview = await Review.findOne({ product: productId, user: req.user._id });
  if (existingReview) {
    throw new ApiError(409, "You have already reviewed this product");
  }

  const imageFiles = req.files || [];
  if (imageFiles.length > 5) {
    throw new ApiError(400, "A review can have at most 5 images");
  }

  const images = [];
  for (const file of imageFiles) {
    const uploaded = await uploadOnCloudinary(file.path);
    if (uploaded?.url) images.push(uploaded.url);
  }

  const review = await Review.create({
    product: productId,
    user: req.user._id,
    order: orderId,
    rating,
    comment,
    images,
  });

  await recalculateProductRatings(productId);

  return res.status(201).json(new ApiResponse(201, review, "Review submitted successfully"));
});

// ---- GET all reviews for a product (public) — hidden reviews never appear here ----
const getProductReviews = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  const reviews = await Review.find({ product: productId, moderationStatus: "visible" })
    .populate("user", "userName avatar")
    .populate("sellerResponses.seller", "userName")
    .sort({ createdAt: -1 });

  return res.status(200).json(new ApiResponse(200, reviews, "Reviews fetched successfully"));
});

// ---- UPDATE own review ----
const updateReview = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;
  const { rating, comment } = req.body;

  const review = await Review.findOne({ _id: reviewId, user: req.user._id });
  if (!review) {
    throw new ApiError(404, "Review not found");
  }

  if (rating) review.rating = rating;
  if (comment !== undefined) review.comment = comment;

  const imageFiles = req.files || [];
  if (imageFiles.length > 0) {
    if (imageFiles.length > 5) {
      throw new ApiError(400, "A review can have at most 5 images");
    }
    const images = [];
    for (const file of imageFiles) {
      const uploaded = await uploadOnCloudinary(file.path);
      if (uploaded?.url) images.push(uploaded.url);
    }
    review.images = images; // replaces the previous set
  }

  await review.save();
  await recalculateProductRatings(review.product);

  return res.status(200).json(new ApiResponse(200, review, "Review updated successfully"));
});

// ---- DELETE own review ----
const deleteReview = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;

  const review = await Review.findOne({ _id: reviewId, user: req.user._id });
  if (!review) {
    throw new ApiError(404, "Review not found");
  }

  const productId = review.product;
  await Review.findByIdAndDelete(reviewId);
  await recalculateProductRatings(productId);

  return res.status(200).json(new ApiResponse(200, {}, "Review deleted successfully"));
});

// ---- Toggle "helpful" vote — one per user, calling again removes it ----
const toggleHelpfulVote = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;

  const review = await Review.findOne({ _id: reviewId, moderationStatus: "visible" });
  if (!review) {
    throw new ApiError(404, "Review not found");
  }

  const userIdStr = req.user._id.toString();
  const alreadyVoted = review.helpfulVotes.some((id) => id.toString() === userIdStr);

  if (alreadyVoted) {
    review.helpfulVotes = review.helpfulVotes.filter((id) => id.toString() !== userIdStr);
  } else {
    review.helpfulVotes.push(req.user._id);
  }

  await review.save();

  return res.status(200).json(
    new ApiResponse(
      200,
      { helpfulCount: review.helpfulVotes.length, votedByMe: !alreadyVoted },
      alreadyVoted ? "Helpful vote removed" : "Marked as helpful"
    )
  );
});

// ---- Report a review as abusive/inappropriate — any logged-in user, once each ----
const reportReview = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;
  const { reason } = req.body;

  if (!reason) {
    throw new ApiError(400, "A reason is required to report a review");
  }

  const review = await Review.findById(reviewId);
  if (!review) {
    throw new ApiError(404, "Review not found");
  }

  const alreadyReported = review.reports.some((r) => r.reportedBy.toString() === req.user._id.toString());
  if (alreadyReported) {
    throw new ApiError(409, "You have already reported this review");
  }

  review.reports.push({ reportedBy: req.user._id, reason });
  await review.save();

  return res.status(200).json(new ApiResponse(200, {}, "Review reported — our team will look into it"));
});

module.exports = {
  createReview,
  getProductReviews,
  updateReview,
  deleteReview,
  toggleHelpfulVote,
  reportReview,
  recalculateProductRatings,
};