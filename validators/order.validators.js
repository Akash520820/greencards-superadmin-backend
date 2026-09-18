const { z } = require("zod");

// A "variant" selector is optional overall, but if color/size are present
// they must be non-empty strings — matches how product.model.js's
// findVariant() treats a missing vs. empty selector.
const variantSchema = z
  .object({
    color: z.string().trim().min(1).optional(),
    size: z.string().trim().min(1).optional(),
  })
  .optional();

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

// Both "buy now" (productId present) and "checkout my cart" (productId
// absent) go through the same body shape — resolveOrderItems() in the
// controller decides which path based on productId's presence, same as
// before this change.
const buyNowOrCartSchema = z.object({
  productId: objectIdSchema.optional(),
  quantity: z.coerce.number().int().positive().optional(),
  variant: variantSchema,
});

const shippingAddressSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required"),
  phone: z.string().regex(/^[6-9]\d{9}$/, "Please provide a valid 10-digit phone number"),
  addressLine1: z.string().trim().min(1, "Address line 1 is required"),
  addressLine2: z.string().trim().optional(),
  city: z.string().trim().min(1, "City is required"),
  state: z.string().trim().min(1, "State is required"),
  pincode: z.string().regex(/^\d{6}$/, "Pincode must be 6 digits"),
  country: z.string().trim().optional(),
});

const placeOrderSchema = buyNowOrCartSchema.extend({
  shippingAddress: shippingAddressSchema,
  paymentMethod: z.enum(["razorpay", "cod"]),
  razorpayOrderId: z.string().optional(),
  razorpayPaymentId: z.string().optional(),
  razorpaySignature: z.string().optional(),
  // client-generated once per checkout attempt (e.g. crypto.randomUUID()) —
  // see order.controller.js's idempotency handling
  idempotencyKey: z.string().min(1).max(100).optional(),
});

const updateOrderStatusSchema = z.object({
  orderStatus: z.enum(["processing", "shipped", "delivered", "cancelled"]),
});

module.exports = {
  buyNowOrCartSchema,
  placeOrderSchema,
  updateOrderStatusSchema,
  objectIdSchema,
  variantSchema,
};
