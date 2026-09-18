const asyncHandler = require("../shared/utils/asyncHandler");
const ApiError = require("../shared/utils/ApiError");
const ApiResponse = require("../shared/utils/ApiResponse");
const User = require("../models/user.model");
const Product = require("../models/product.model");

// ---- GET wishlist ----
const getWishlist = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate(
    "wishlist",
    "name slug images price discountPrice stock"
  );

  return res.status(200).json(new ApiResponse(200, user.wishlist, "Wishlist fetched successfully"));
});

// ---- ADD to wishlist ----
const addToWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.body;

  if (!productId) {
    throw new ApiError(400, "Product ID is required");
  }

  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  const user = await User.findById(req.user._id);

  if (user.wishlist.includes(productId)) {
    throw new ApiError(409, "Product already in wishlist");
  }

  user.wishlist.push(productId);
  await user.save({ validateBeforeSave: false });

  return res.status(200).json(new ApiResponse(200, user.wishlist, "Product added to wishlist"));
});

// ---- REMOVE from wishlist ----
const removeFromWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  const user = await User.findById(req.user._id);

  user.wishlist = user.wishlist.filter((id) => id.toString() !== productId);
  await user.save({ validateBeforeSave: false });

  return res.status(200).json(new ApiResponse(200, user.wishlist, "Product removed from wishlist"));
});

module.exports = { getWishlist, addToWishlist, removeFromWishlist };