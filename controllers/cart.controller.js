const asyncHandler = require("../shared/utils/asyncHandler");
const ApiError = require("../shared/utils/ApiError");
const ApiResponse = require("../shared/utils/ApiResponse");
const Cart = require("../models/cart.model");
const Product = require("../models/product.model");

// validates and (if needed) auto-fills the variant selection before adding/updating a cart item
const resolveVariantSelection = (product, variant) => {
  if (product.colorVariants.length === 0) {
    return {}; // Scenario 2 — no variant needed at all.If the product has no colorVariants (meaning it’s a simple product with one fixed option)
  }

  if (!variant?.color) {
    throw new ApiError(400, "Please select a color for this product");
  }

  const colorVariant = product.colorVariants.find((cv) => cv.color === variant.color);
  if (!colorVariant) {
    throw new ApiError(404, `Color "${variant.color}" not available for this product`);
  }

  if (colorVariant.sizes.length > 1 && !variant.size) { //colorVariant.sizes.length > 1 This checks how many size options exist under a specific color
    throw new ApiError(400, "Please select a size for this product");
  }

  // only one size exists (e.g. placeholder "Default" color, single size) — auto-fill it
  const size = variant.size || colorVariant.sizes[0]?.size;

  return { color: variant.color, size };
};

// ---- GET current user's cart ----
const getCart = asyncHandler(async (req, res) => {
  let cart = await Cart.findOne({ user: req.user._id }).populate(
    "items.product",
    "name slug images price discountPrice stock colorVariants"
  );

  if (!cart) {
    cart = await Cart.create({ user: req.user._id, items: [] });
  }

  return res.status(200).json(new ApiResponse(200, cart, "Cart fetched successfully"));
});

// ---- ADD item to cart ----
const addToCart = asyncHandler(async (req, res) => {
  const { productId, quantity = 1 } = req.body; //Default quantity is 1 if not provided
  let { variant } = req.body;

  if (!productId) {
    throw new ApiError(400, "Product ID is required");
  }

  const product = await Product.findById(productId);
  if (!product || !product.isActive) {
    throw new ApiError(404, "Product not found");
  }

  variant = resolveVariantSelection(product, variant);
  const availableStock = product.getStockForVariant(variant);
  const variantColor = variant.color || null;
  const variantSize = variant.size || null;

  // Ensure a cart document exists up front (upsert is atomic, so concurrent
  // first-time requests for the same user can't create two cart docs).
  await Cart.updateOne(
    { user: req.user._id },
    { $setOnInsert: { user: req.user._id, items: [] } },
    { upsert: true }
  );

  // Try to atomically bump an existing line for this exact product+variant.
  // Using $elemMatch + the positional operator means the read (does a
  // matching line exist?) and the write (increment it) happen as one atomic
  // operation on the DB side — two concurrent requests can't both "see no
  // existing item" and both push a brand-new line, which is what was
  // causing duplicate cart entries under rapid/overlapping clicks.
  let cart = await Cart.findOneAndUpdate(
    {
      user: req.user._id,
      items: { $elemMatch: { product: productId, "variant.color": variantColor, "variant.size": variantSize } },
    },
    { $inc: { "items.$.quantity": Number(quantity) } },
    { new: true }
  );

  if (!cart) {
    // No existing line — push one. findOneAndUpdate here is still atomic per
    // document, but two concurrent "first add" requests can still race into
    // two separate pushes; the retry below cleans that up if it happens.
    cart = await Cart.findOneAndUpdate(
      { user: req.user._id },
      { $push: { items: { product: productId, quantity: Number(quantity), variant } } },
      { new: true }
    );
  }

  // Re-check stock against the line's final quantity now that the update has
  // landed, and roll back if two racing requests together overshot stock.
  const line = cart.items.find(
    (item) =>
      item.product.toString() === productId &&
      (item.variant?.color || null) === variantColor &&
      (item.variant?.size || null) === variantSize
  );
  if (line && line.quantity > availableStock) {
    const rollbackBy = line.quantity - availableStock;
    if (availableStock <= 0) {
      cart.items.pull(line._id);
    } else {
      line.quantity = availableStock;
    }
    await cart.save();
    throw new ApiError(400, `Not enough stock available (only ${availableStock} left, requested ${rollbackBy + availableStock})`);
  }

  // it returns all the products currently in the cart
  const populatedCart = await cart.populate("items.product", "name slug images price discountPrice stock colorVariants");

  return res.status(200).json(new ApiResponse(200, populatedCart, "Item added to cart"));
});

// ---- UPDATE quantity of a cart item ----
const updateCartItem = asyncHandler(async (req, res) => {
  const { itemId } = req.params;
  const { quantity } = req.body;

  if (!quantity || quantity < 1) {
    throw new ApiError(400, "Valid quantity is required");
  }

  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) {
    throw new ApiError(404, "Cart not found");
  }

  const item = cart.items.id(itemId);
  if (!item) {
    throw new ApiError(404, "Cart item not found");
  }

  const product = await Product.findById(item.product);
  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  // this is a SET (absolute), not an add — checking directly against quantity is correct here
  const availableStock = product.getStockForVariant(item.variant || {});
  if (availableStock < quantity) {
    throw new ApiError(400, "Not enough stock available");
  }

  item.quantity = quantity;
  await cart.save();

  const populatedCart = await cart.populate("items.product", "name slug images price discountPrice stock colorVariants");

  return res.status(200).json(new ApiResponse(200, populatedCart, "Cart item updated"));
});

// ---- REMOVE item from cart ----
const removeFromCart = asyncHandler(async (req, res) => {
  const { itemId } = req.params;

  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) {
    throw new ApiError(404, "Cart not found");
  }

  const item = cart.items.id(itemId);
  if (!item) {
    throw new ApiError(404, "Cart item not found");
  }

  item.deleteOne();
  await cart.save();

  const populatedCart = await cart.populate("items.product", "name slug images price discountPrice stock colorVariants");

  return res.status(200).json(new ApiResponse(200, populatedCart, "Item removed from cart"));
});

// ---- CLEAR entire cart ----
const clearCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) {
    throw new ApiError(404, "Cart not found");
  }

  cart.items = [];
  await cart.save();

  return res.status(200).json(new ApiResponse(200, cart, "Cart cleared"));
});

module.exports = { getCart, addToCart, updateCartItem, removeFromCart, clearCart };