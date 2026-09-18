const { z } = require("zod");
const { objectIdSchema } = require("../validators/order.validators");

// parentCategory arrives as a string over multipart/form-data — either a
// valid ObjectId, or an empty string meaning "no parent" (the controller
// does `parentCategory || null`), so both are accepted here.
const parentCategorySchema = z.union([objectIdSchema, z.literal("")]).optional();

const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Category name is required").max(100),
  description: z.string().trim().optional(),
  parentCategory: parentCategorySchema,
});

const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().optional(),
  parentCategory: parentCategorySchema,
  isActive: z.coerce.boolean().optional(),
});

const categoryIdParamSchema = z.object({
  categoryId: objectIdSchema,
});

module.exports = { createCategorySchema, updateCategorySchema, categoryIdParamSchema };
