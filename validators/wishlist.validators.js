const { z } = require("zod");
const { objectIdSchema } = require("./order.validators");

const addToWishlistSchema = z.object({
  productId: objectIdSchema,
});

const wishlistProductIdParamSchema = z.object({
  productId: objectIdSchema,
});

module.exports = { addToWishlistSchema, wishlistProductIdParamSchema };
