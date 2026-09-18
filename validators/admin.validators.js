const { z } = require("zod");
const { objectIdSchema } = require("../validators/order.validators");

const sellerStatusQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "suspended"]).optional(),
});

const rejectSellerSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

const verifyBankDetailsSchema = z.object({
  verificationStatus: z.enum(["verified", "rejected"], {
    error: "verificationStatus must be 'verified' or 'rejected'",
  }),
});

const hideReviewSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

const sellerIdParamSchema = z.object({ sellerId: objectIdSchema });
const reviewIdParamSchema = z.object({ reviewId: objectIdSchema });

const userIdParamSchema = z.object({ userId: objectIdSchema });

module.exports = {
  sellerStatusQuerySchema,
  rejectSellerSchema,
  verifyBankDetailsSchema,
  hideReviewSchema,
  sellerIdParamSchema,
  reviewIdParamSchema,
  userIdParamSchema,
};
