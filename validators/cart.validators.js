const { z } = require("zod");
const { objectIdSchema } = require("./order.validators");

const variantSchema = z
  .object({
    color: z.string().trim().min(1).optional(),
    size: z.string().trim().min(1).optional(),
  })
  .optional();

const addToCartSchema = z.object({
  productId: objectIdSchema,
  quantity: z.coerce.number().int().positive().optional(), // controller defaults to 1 if omitted
  variant: variantSchema,
});

const updateCartItemSchema = z.object({
  quantity: z.coerce.number().int().positive("Valid quantity is required"),
});

// cart items are Mongoose subdocuments — they get a real ObjectId `_id` by
// default, same format as top-level documents.
const itemIdParamSchema = z.object({
  itemId: objectIdSchema,
});

module.exports = { addToCartSchema, updateCartItemSchema, itemIdParamSchema };
