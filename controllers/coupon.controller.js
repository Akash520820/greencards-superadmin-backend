const asyncHandler = require("../shared/utils/asyncHandler");
const ApiError = require("../shared/utils/ApiError");
const ApiResponse = require("../shared/utils/ApiResponse");
const Coupon = require("../models/coupon.model");

// Admin: Create new coupon
const createCoupon = asyncHandler(async (req, res) => {
  const {
    code,
    discountType,
    discountValue,
    minOrderAmount = 0,
    maxDiscountAmount,
    expiresAt,
    usageLimit = 100,
  } = req.body;

  if (!code || !discountType || discountValue === undefined || !expiresAt) {
    throw new ApiError(400, "Please provide all required fields: code, discountType, discountValue, expiresAt");
  }

  const existingCoupon = await Coupon.findOne({ code: code.toUpperCase() });
  if (existingCoupon) {
    throw new ApiError(409, "Coupon code already exists");
  }

  const coupon = await Coupon.create({
    code: code.toUpperCase(),
    discountType,
    discountValue: Number(discountValue),
    minOrderAmount: Number(minOrderAmount),
    maxDiscountAmount: maxDiscountAmount ? Number(maxDiscountAmount) : undefined,
    expiresAt: new Date(expiresAt),
    usageLimit: Number(usageLimit),
  });

  return res.status(201).json(new ApiResponse(201, coupon, "Coupon created successfully"));
});

// Admin: Get all coupons
const getAllCoupons = asyncHandler(async (req, res) => {
  const coupons = await Coupon.find().sort({ createdAt: -1 });
  return res.status(200).json(new ApiResponse(200, coupons, "Coupons fetched successfully"));
});

// Client: Validate coupon code & compute discount
const validateCoupon = asyncHandler(async (req, res) => {
  const { code, cartAmount = 0 } = req.body;

  if (!code) {
    throw new ApiError(400, "Coupon code is required");
  }

  const coupon = await Coupon.findOne({ code: code.toUpperCase(), isActive: true });
  if (!coupon) {
    throw new ApiError(404, "Invalid or expired coupon code");
  }

  if (new Date() > new Date(coupon.expiresAt)) {
    throw new ApiError(400, "Coupon has expired");
  }

  if (coupon.usedCount >= coupon.usageLimit) {
    throw new ApiError(400, "Coupon usage limit reached");
  }

  if (cartAmount < coupon.minOrderAmount) {
    throw new ApiError(
      400,
      `Minimum order amount for this coupon is ₹${coupon.minOrderAmount}`
    );
  }

  let discount = 0;
  if (coupon.discountType === "percentage") {
    discount = (cartAmount * coupon.discountValue) / 100;
    if (coupon.maxDiscountAmount && discount > coupon.maxDiscountAmount) {
      discount = coupon.maxDiscountAmount;
    }
  } else if (coupon.discountType === "flat") {
    discount = coupon.discountValue;
  }

  discount = Math.min(discount, cartAmount);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        discountAmount: Math.round(discount),
        finalAmount: Math.round(cartAmount - discount),
      },
      "Coupon applied successfully"
    )
  );
});

// Admin: Delete coupon
const deleteCoupon = asyncHandler(async (req, res) => {
  const { couponId } = req.params;
  const coupon = await Coupon.findByIdAndDelete(couponId);
  if (!coupon) {
    throw new ApiError(404, "Coupon not found");
  }
  return res.status(200).json(new ApiResponse(200, {}, "Coupon deleted successfully"));
});

module.exports = {
  createCoupon,
  getAllCoupons,
  validateCoupon,
  deleteCoupon,
};
