const asyncHandler = require("../shared/utils/asyncHandler");
const ApiResponse = require("../shared/utils/ApiResponse");
const User = require("../models/user.model");
const Staff = require("../models/staff.model");
const Product = require("../models/product.model");
const Order = require("../models/order.model");
const Return = require("../models/return.model");
const Category = require("../models/category.model");

// ---- Full system dashboard — everything a regular admin sees, plus staff stats ----
// Staff account management (create/promote/deactivate/permissions) lives
// under /api/v1/staff now (see staff.controller.js + accessRequest.controller.js)
// — this stays a read-only summary.
const getFullDashboard = asyncHandler(async (req, res) => {
  const [
    totalUsers,
    totalAdmins,
    totalSuperAdmins,
    totalProducts,
    totalCategories,
    totalOrders,
    totalReturns,
    revenueResult,
    ordersByStatus,
    returnsByStatus,
    pendingReturnsCount,
    lowStockProducts,
  ] = await Promise.all([
    User.countDocuments({ role: "user" }),
    Staff.countDocuments({ role: "admin" }),
    Staff.countDocuments({ role: "superadmin" }),
    Product.countDocuments(),
    Category.countDocuments(),
    Order.countDocuments(),
    Return.countDocuments(),
    Order.aggregate([
      { $match: { paymentStatus: "paid" } },
      { $group: { _id: null, totalRevenue: { $sum: "$totalPrice" } } },
    ]),
    Order.aggregate([{ $group: { _id: "$orderStatus", count: { $sum: 1 } } }]),
    Return.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Return.countDocuments({ status: "requested" }),
    Product.find({ stock: { $lte: 5 }, colorVariants: { $size: 0 } }).select("name stock"),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        totalUsers,
        totalAdmins,
        totalSuperAdmins,
        totalProducts,
        totalCategories,
        totalOrders,
        totalReturns,
        totalRevenue: revenueResult[0]?.totalRevenue || 0,
        ordersByStatus,
        returnsByStatus,
        pendingReturnsCount,
        lowStockProducts,
      },
      "Full dashboard fetched successfully"
    )
  );
});

module.exports = { getFullDashboard };
