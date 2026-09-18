const { z } = require("zod");
const { objectIdSchema, variantSchema } = require("./order.validators");

const returnItemSchema = z.object({
  productId: objectIdSchema,
  quantity: z.coerce.number().int().positive("Quantity must be a positive number"),
  variant: variantSchema,
});

const createReturnSchema = z.object({
  orderId: objectIdSchema,
  items: z.array(returnItemSchema).min(1, "At least one item is required"),
  reason: z.string().trim().min(1, "A reason is required").max(1000),
});

const reviewReturnSchema = z.object({
  status: z.enum(["approved", "rejected"], { error: "Status must be 'approved' or 'rejected'" }),
});

const processRefundSchema = z.object({
  refundMethod: z.enum(["cod", "razorpay"], {
    error: "A valid refund method (cod or razorpay) is required",
  }),
});

const returnIdParamSchema = z.object({
  returnId: objectIdSchema,
});

module.exports = { createReturnSchema, reviewReturnSchema, processRefundSchema, returnIdParamSchema };
