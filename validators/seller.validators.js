const { z } = require("zod");
const { objectIdSchema } = require("../validators/order.validators");

// IFSC: 4 letters (bank code), a literal 0, then 6 alphanumeric (branch code)
// — the standard Indian bank-branch code format.
const ifscSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Please provide a valid IFSC code");

const applyForSellerSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required").max(200),
  gstNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z]{1}[A-Z\d]$/, "Please provide a valid 15-character GSTIN"),
  storeDescription: z.string().trim().max(2000).optional(),
  accountHolderName: z.string().trim().min(1, "Account holder name is required"),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{9,18}$/, "Please provide a valid bank account number"),
  ifscCode: ifscSchema,
  bankName: z.string().trim().min(1, "Bank name is required"),
  bankBranch: z.string().trim().min(1, "Bank branch is required"),
  accountType: z.enum(["savings", "current", "business"]).optional(),
  upiId: z.string().trim().optional(),
});

const respondToReviewSchema = z.object({
  comment: z.string().trim().min(1, "A response comment is required").max(1000),
});

const reviewIdParamSchema = z.object({
  reviewId: objectIdSchema,
});

const reviewResponseParamSchema = z.object({
  reviewId: objectIdSchema,
  responseId: objectIdSchema,
});

module.exports = {
  applyForSellerSchema,
  respondToReviewSchema,
  reviewIdParamSchema,
  reviewResponseParamSchema,
};
