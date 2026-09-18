const { z } = require("zod");
const { objectIdSchema } = require("./order.validators");

// These routes are multipart/form-data (multer parses the images, everything
// else arrives as a string on req.body) — hence z.coerce.number() rather
// than z.number(), and colorVariants stays a raw string here (it's a JSON
// blob the controller itself JSON.parses; this only confirms it decodes to
// something JSON.parse won't choke on, not its inner shape — see the
// dedicated colorVariantsJsonSchema below for that).
const colorVariantsJsonSchema = z
  .string()
  .optional()
  .refine(
    (val) => {
      if (!val) return true;
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed);
      } catch {
        return false;
      }
    },
    { message: "colorVariants must be a JSON array string" }
  );

const createProductSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().trim().min(1, "Description is required"),
  category: objectIdSchema,
  price: z.coerce.number().positive("Price must be greater than 0"),
  discountPrice: z.coerce.number().min(0).optional(),
  stock: z.coerce.number().int().min(0).optional(),
  sku: z.string().trim().optional(),
  brand: z.string().trim().optional(),
  colorVariants: colorVariantsJsonSchema,
});

const updateProductSchema = createProductSchema.partial().extend({
  isActive: z.coerce.boolean().optional(),
});

const updateStockSchema = z.object({
  stock: z.coerce.number().int().min(0, "Stock cannot be negative"),
  color: z.string().trim().optional(),
  size: z.string().trim().optional(),
});

const addColorVariantImagesSchema = z.object({
  color: z.string().trim().min(1, "Color is required"),
});

const productIdParamSchema = z.object({
  productId: objectIdSchema,
});

module.exports = {
  createProductSchema,
  updateProductSchema,
  updateStockSchema,
  addColorVariantImagesSchema,
  productIdParamSchema,
};
