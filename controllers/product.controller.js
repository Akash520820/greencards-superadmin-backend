const asyncHandler = require("../shared/utils/asyncHandler");
const ApiError = require("../shared/utils/ApiError");
const ApiResponse = require("../shared/utils/ApiResponse");
const Product = require("../models/product.model");
const Category = require("../models/category.model");
const { uploadOnCloudinary } = require("../shared/utils/cloudinary");
const mongoose = require("mongoose");
const logger = require("../shared/utils/logger");

// $search requires a MongoDB Atlas Search index named "products_search" to
// already exist on the products collection — it is NOT created automatically
// and does not exist on a fresh cluster. Rather than have search silently
// return nothing (or 500) on a new deployment until someone remembers to
// create it in the Atlas UI, we detect that specific failure and fall back
// to a plain, always-available regex match. It's less relevant-ranked than
// real Atlas Search, but it works out of the box everywhere, including
// non-Atlas MongoDB (self-hosted, Docker, other clouds).
let atlasSearchIndexMissingWarned = false;
const isSearchIndexMissingError = (err) =>
  err?.codeName === "SearchNotEnabled" ||
  /index.*not found|no such.*search index|SearchNotEnabled/i.test(err?.message || "");

// ---- CREATE product (admin or approved seller — creator becomes the owner) ----
const createProduct = asyncHandler(async (req, res) => {
  const { name, description, category, price, discountPrice, stock, sku, brand, colorVariants } = req.body;

  if (!name || !description || !category || !price) {
    throw new ApiError(400, "Name, description, category, and price are required");
  }

  const categoryExists = await Category.findById(category);
  if (!categoryExists) {
    throw new ApiError(400, "Invalid category");
  }

  // colorVariants sent as a JSON string in form-data, e.g.
  // [{"color":"Red","images":[],"priceModifier":0,"sizes":[{"size":"S","sku":"TSHIRT-S-RED","stock":10}]}]
  // (per-color images are uploaded separately, after creation — see addColorVariantImages below)
  const parsedColorVariants = colorVariants ? JSON.parse(colorVariants) : [];

  const imageFiles = req.files;
  // Base/fallback images are required for a plain product (they're its only images).
  // Once color variants exist, each color supplies its own images in a follow-up request,
  // so the base set becomes optional here.
  if ((!imageFiles || imageFiles.length === 0) && parsedColorVariants.length === 0) {
    throw new ApiError(400, "At least one product image is required");
  }

  const uploadedImages = [];
  for (const file of imageFiles || []) {
    const uploaded = await uploadOnCloudinary(file.path);
    if (!uploaded?.url) {
      throw new ApiError(500, "Something went wrong while uploading product images");
    }
    uploadedImages.push(uploaded.url);
  }

  const product = await Product.create({
    name: name.trim(),
    description,
    category,
    images: uploadedImages,
    price,
    discountPrice: discountPrice || 0,
    stock: stock || 0, // only meaningful if parsedColorVariants is empty
    sku,
    brand,
    colorVariants: parsedColorVariants,
    createdBy: req.user._id,
  });

  return res
    .status(201)
    .json(new ApiResponse(201, product, "Product created successfully"));
});

// ---- GET all products (public) — with filtering, search, pagination ----
const getAllProducts = asyncHandler(async (req, res) => {
  const { search, category, minPrice, maxPrice, sort, page = 1, limit = 12 } = req.query;

  const skip = (Number(page) - 1) * Number(limit);
  const pageLimit = Number(limit);

  const matchFilter = { isActive: true };
  if (category) matchFilter.category = new mongoose.Types.ObjectId(category);
  if (minPrice || maxPrice) {
    matchFilter.price = {};
    if (minPrice) matchFilter.price.$gte = Number(minPrice);
    if (maxPrice) matchFilter.price.$lte = Number(maxPrice);
  }

  let sortStage = { createdAt: -1 };
  if (sort === "price_asc") sortStage = { price: 1 };
  if (sort === "price_desc") sortStage = { price: -1 };
  if (sort === "rating") sortStage = { "ratings.average": -1 };

  const facetStage = {
    $facet: {
      products: [
        { $skip: skip },
        { $limit: pageLimit },
        {
          $lookup: {
            from: "categories",
            localField: "category",
            foreignField: "_id",
            as: "category",
          },
        },
        { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
      ],
      totalCount: [{ $count: "count" }],
    },
  };

  const buildAtlasSearchPipeline = () => {
    const pipeline = [];
    if (search) {
      pipeline.push({
        $search: {
          index: "products_search",
          compound: {
            should: [
              {
                text: {
                  query: search,
                  path: "name",
                  fuzzy: { maxEdits: 2, prefixLength: 2 },
                  score: { boost: { value: 3 } },
                },
              },
              { text: { query: search, path: "description", fuzzy: { maxEdits: 1 } } },
              { text: { query: search, path: "brand", fuzzy: { maxEdits: 1 } } },
            ],
            minimumShouldMatch: 1,
          },
        },
      });
    }
    pipeline.push({ $match: matchFilter });
    if (!search) pipeline.push({ $sort: sortStage });
    pipeline.push(facetStage);
    return pipeline;
  };

  // Fallback used both when there's no search term (Atlas Search isn't
  // needed at all for a plain filter/browse query) and when Atlas Search
  // itself isn't available on this cluster.
  const buildRegexPipeline = () => {
    const pipeline = [];
    const filter = { ...matchFilter };
    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escape regex metacharacters in user input
      filter.$or = [
        { name: { $regex: safeSearch, $options: "i" } },
        { description: { $regex: safeSearch, $options: "i" } },
        { brand: { $regex: safeSearch, $options: "i" } },
      ];
    }
    pipeline.push({ $match: filter });
    pipeline.push({ $sort: sortStage });
    pipeline.push(facetStage);
    return pipeline;
  };

  let result;
  if (search) {
    try {
      result = await Product.aggregate(buildAtlasSearchPipeline());
    } catch (err) {
      if (!isSearchIndexMissingError(err)) throw err;
      if (!atlasSearchIndexMissingWarned) {
        atlasSearchIndexMissingWarned = true;
        logger.warn(
          'Atlas Search index "products_search" not found — falling back to regex search. ' +
            "Create the index in the Atlas UI (Search > Create Search Index) for proper fuzzy/relevance-ranked results."
        );
      }
      result = await Product.aggregate(buildRegexPipeline());
    }
  } else {
    result = await Product.aggregate(buildRegexPipeline());
  }

  const products = result[0].products;
  const total = result[0].totalCount[0]?.count || 0;

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        products,
        pagination: {
          total,
          page: Number(page),
          totalPages: Math.ceil(total / pageLimit),
        },
      },
      "Products fetched successfully"
    )
  );
});

// ---- GET single product by slug (public) ----
const getProductBySlug = asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const product = await Product.findOne({ slug, isActive: true }).populate("category", "name slug");
  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  // distinct colors + which sizes exist per color, so frontend can build swatches then size buttons
  const variantOptions = product.getVariantOptions();

  return res
    .status(200)
    .json(new ApiResponse(200, { ...product.toObject(), variantOptions }, "Product fetched successfully"));
});

// ---- UPDATE product (admin, or the seller who owns it) ----
const updateProduct = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { name, description, category, price, discountPrice, stock, sku, brand, colorVariants, isActive } = req.body;

  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  if (req.user.role === "seller" && product.createdBy.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "You can only update products you created");
  }

  if (category) {
    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      throw new ApiError(400, "Invalid category");
    }
    product.category = category;
  }

  if (name) {
    product.name = name.trim();
    product.slug = undefined; // force slug regeneration
  }
  if (description) product.description = description;
  if (price !== undefined) product.price = price;
  if (discountPrice !== undefined) product.discountPrice = discountPrice;
  if (stock !== undefined) product.stock = stock;
  if (sku !== undefined) product.sku = sku;
  if (brand !== undefined) product.brand = brand;
  if (colorVariants) product.colorVariants = JSON.parse(colorVariants);
  if (isActive !== undefined) product.isActive = isActive;

  // NOTE: this appends to the product's BASE images, not a specific color's images.
  // Per-color image uploads need a dedicated endpoint (see addColorVariantImages below)
  // since form-data can't easily target "images for color X" alongside other fields in one go.
  if (req.files && req.files.length > 0) {
    const uploadedImages = [];
    for (const file of req.files) {
      const uploaded = await uploadOnCloudinary(file.path);
      if (!uploaded?.url) {
        throw new ApiError(500, "Something went wrong while uploading product images");
      }
      uploadedImages.push(uploaded.url);
    }
    product.images.push(...uploadedImages);
  }

  await product.save();

  return res
    .status(200)
    .json(new ApiResponse(200, product, "Product updated successfully"));
});

// ---- UPLOAD images for a specific color variant (admin, or the seller who owns it) ----
const addColorVariantImages = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { color } = req.body;

  if (!color) {
    throw new ApiError(400, "Color is required");
  }

  const imageFiles = req.files;
  if (!imageFiles || imageFiles.length === 0) {
    throw new ApiError(400, "At least one image is required");
  }

  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  if (req.user.role === "seller" && product.createdBy.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "You can only update products you created");
  }

  const colorVariant = product.colorVariants.find((cv) => cv.color === color);
  if (!colorVariant) {
    throw new ApiError(404, `Color "${color}" not found on this product`);
  }

  const uploadedImages = [];
  for (const file of imageFiles) {
    const uploaded = await uploadOnCloudinary(file.path);
    if (!uploaded?.url) {
      throw new ApiError(500, "Something went wrong while uploading images");
    }
    uploadedImages.push(uploaded.url);
  }

  colorVariant.images.push(...uploadedImages);
  await product.save();

  return res
    .status(200)
    .json(new ApiResponse(200, product, `Images added for color "${color}"`));
});

// ---- DELETE product (admin, or the seller who owns it) ----
const deleteProduct = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  if (req.user.role === "seller" && product.createdBy.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "You can only delete products you created");
  }

  await Product.findByIdAndDelete(productId);

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Product deleted successfully"));
});

// ---- UPDATE stock — for a specific color+size combination, or the whole product if no variants ----
const updateStock = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { stock, color, size } = req.body;

  if (stock === undefined || stock < 0) {
    throw new ApiError(400, "Valid stock value is required");
  }

  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  if (req.user.role === "seller" && product.createdBy.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "You can only update stock for products you created");
  }

  if (color) {
    if (!size) {
      throw new ApiError(400, "Size is required when updating stock for a specific color");
    }

    const { colorVariant, sizeVariant } = product.findVariant({ color, size });
    if (!colorVariant) {
      throw new ApiError(404, `Color "${color}" not found on this product`);
    }
    if (!sizeVariant) {
      throw new ApiError(404, `Size "${size}" not found under color "${color}"`);
    }
    sizeVariant.stock = stock;
  } else {
    // no color given — updating the top-level stock (Scenario 2 products)
    product.stock = stock;
  }

  await product.save();

  return res
    .status(200)
    .json(new ApiResponse(200, product, "Stock updated successfully"));
});

// ---- GET top Bestsellers (public) ----
const getBestSellers = asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit) || 8;

  // Find active products sorted by totalSold descending, falling back to rating count
  const bestSellers = await Product.find({ isActive: true })
    .populate("category", "name slug")
    .sort({ totalSold: -1, "ratings.count": -1, createdAt: -1 })
    .limit(limit);

  return res
    .status(200)
    .json(new ApiResponse(200, bestSellers, "Bestsellers fetched successfully"));
});

// ---- GET active Flash Sale products (public) ----
const getFlashSaleProducts = asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;

  // Find active flash sale items where discount exists or flashSaleEndsAt is future (or default)
  const now = new Date();
  const query = {
    isActive: true,
    $or: [
      { isFlashSale: true },
      { flashSaleEndsAt: { $gt: now } },
      { discountPrice: { $gt: 0 } }
    ]
  };

  const flashSaleProducts = await Product.find(query)
    .populate("category", "name slug")
    .sort({ updatedAt: -1 })
    .limit(limit);

  // Set default flash sale expiry 12 hours from now if flashSaleEndsAt is missing
  const flashSaleEndsAt = flashSaleProducts.find(p => p.flashSaleEndsAt)?.flashSaleEndsAt || new Date(Date.now() + 12 * 60 * 60 * 1000);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { products: flashSaleProducts, flashSaleEndsAt },
        "Flash sale products fetched successfully"
      )
    );
});

module.exports = {
  createProduct,
  getAllProducts,
  getProductBySlug,
  updateProduct,
  addColorVariantImages,
  deleteProduct,
  updateStock,
  getBestSellers,
  getFlashSaleProducts,
};