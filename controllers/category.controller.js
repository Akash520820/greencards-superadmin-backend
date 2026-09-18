const asyncHandler = require("../shared/utils/asyncHandler");
const ApiError = require("../shared/utils/ApiError");
const ApiResponse = require("../shared/utils/ApiResponse");
const Category = require("../models/category.model");
const { uploadOnCloudinary } = require("../shared/utils/cloudinary");

// ---- CREATE category (admin only) ----
const createCategory = asyncHandler(async (req, res) => {
  const { name, description, parentCategory } = req.body;

  if (!name) {
    throw new ApiError(400, "Category name is required");
  }

  const existing = await Category.findOne({ name: name.trim() });
  if (existing) {
    throw new ApiError(409, "Category with this name already exists");
  }

  let imageUrl;
  if (req.file?.path) {
    const uploaded = await uploadOnCloudinary(req.file.path);
    if (!uploaded?.url) {
      throw new ApiError(500, "Something went wrong while uploading category image");
    }
    imageUrl = uploaded.url;
  }

  const category = await Category.create({
    name: name.trim(),
    description,
    image: imageUrl,
    parentCategory: parentCategory || null,
  });

  return res
    .status(201)
    .json(new ApiResponse(201, category, "Category created successfully"));
});

// ---- GET all categories (public) ----
const getAllCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({ isActive: true }).populate("parentCategory", "name slug");

  return res
    .status(200)
    .json(new ApiResponse(200, categories, "Categories fetched successfully"));
});

// ---- GET single category by slug (public) ----
const getCategoryBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const category = await Category.findOne({ slug, isActive: true });
  if (!category) {
    throw new ApiError(404, "Category not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, category, "Category fetched successfully"));
});

// ---- UPDATE category (admin only) ----
const updateCategory = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;
  const { name, description, parentCategory, isActive } = req.body;

  const category = await Category.findById(categoryId);
  if (!category) {
    throw new ApiError(404, "Category not found");
  }

  if (name) {
    category.name = name.trim();
    category.slug = undefined; // force slug regeneration via pre("validate") hook
  }
  if (description !== undefined) category.description = description;
  if (parentCategory !== undefined) category.parentCategory = parentCategory || null;
  if (isActive !== undefined) category.isActive = isActive;

  if (req.file?.path) {
    const uploaded = await uploadOnCloudinary(req.file.path);
    if (!uploaded?.url) {
      throw new ApiError(500, "Something went wrong while uploading category image");
    }
    category.image = uploaded.url;
  }

  await category.save();

  return res
    .status(200)
    .json(new ApiResponse(200, category, "Category updated successfully"));
});

// ---- DELETE category (admin only) ----
const deleteCategory = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;

  const category = await Category.findById(categoryId);
  if (!category) {
    throw new ApiError(404, "Category not found");
  }

  await Category.findByIdAndDelete(categoryId);

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Category deleted successfully"));
});

module.exports = {
  createCategory,
  getAllCategories,
  getCategoryBySlug,
  updateCategory,
  deleteCategory,
};