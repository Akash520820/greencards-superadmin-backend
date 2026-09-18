const { z } = require("zod");
const { objectIdSchema } = require("./order.validators");

// Matches the review model's own `min: 1, max: 5` constraint — catching it
// here means a bad rating never reaches Mongoose validation (or worse,
// silently coerces) and gets a clean 400 with a clear message instead.
const ratingSchema = z.coerce.number().int().min(1, "Rating must be between 1 and 5").max(5, "Rating must be between 1 and 5");

const createReviewSchema = z.object({
  productId: objectIdSchema,
  orderId: objectIdSchema,
  rating: ratingSchema,
  comment: z.string().trim().max(2000).optional(),
});

const updateReviewSchema = z.object({
  rating: ratingSchema.optional(),
  comment: z.string().trim().max(2000).optional(),
});

const reportReviewSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required to report a review").max(500),
});

const reviewIdParamSchema = z.object({
  reviewId: objectIdSchema,
});

const productIdParamSchema = z.object({
  productId: objectIdSchema,
});

module.exports = {
  createReviewSchema,
  updateReviewSchema,
  reportReviewSchema,
  reviewIdParamSchema,
  productIdParamSchema,
};
