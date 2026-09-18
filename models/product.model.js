const mongoose = require("mongoose");

const sizeSchema = new mongoose.Schema(
  {
    size: {
      type: String, 
      required: true, 
      trim: true 
    }, // e.g. "S", "M", "L", or "One Size"
    sku: { 
      type: String, 
      trim: true 
    },
    priceModifier: { 
      type: Number, 
      default: 0 
    }, // added on top of the color's own modifier
    stock: { 
      type: Number, 
      default: 0, 
      min: 0 
    },
  },
  { _id: false }
);

const colorVariantSchema = new mongoose.Schema(
  {
    color: { 
      type: String, 
      required: true, 
      trim: true 
    }, // e.g. "Red", "Blue"
    images: [{ 
      type: String 
    }], // this color's own photo set — falls back to product.images if empty
    priceModifier: { 
      type: Number, 
      default: 0 
    }, // e.g. a premium color costs more
    sizes: [sizeSchema], // must have at least one entry — use "One Size" if no real size variation
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    description: {
      type: String,
      required: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    images: [
      {
        type: String,
        required: true,
      },
    ], // base/fallback images — used when a color has no images of its own, or product has no variants at all
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    discountPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    // only meaningful when the product has NO colorVariants (Scenario 2 — single fixed option)
    stock: {
      type: Number,
      min: 0,
      default: 0,
    },
    // only meaningful when the product has NO colorVariants
    sku: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    brand: {
      type: String,
      trim: true,
    },
    // Scenario 1 — Amazon/Flipkart style: color is the top grouping (own images + own price),
    // each color contains its own sizes (own stock + optional extra price modifier)
    colorVariants: [colorVariantSchema],
    ratings: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0 },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    totalSold: {
      type: Number,
      default: 0,
      min: 0,
      index: true,
    },
    isFlashSale: {
      type: Boolean,
      default: false,
      index: true,
    },
    flashSaleDiscountPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    flashSaleEndsAt: {
      type: Date,
    },
    isHotDeal: {
      type: Boolean,
      default: false,
      index: true,
    },
    freeShipping: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

productSchema.index({ name: "text", description: "text", brand: "text" });
productSchema.index({ category: 1, isActive: 1, price: 1 });


// async hook — no "next" parameter, ever
productSchema.pre("validate", async function () {
  if (this.name && !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }
});

// base selling price — ignores variants, use getPriceForVariant() when a color/size is selected
productSchema.virtual("finalPrice").get(function () {
  return this.discountPrice > 0 ? this.discountPrice : this.price;
});

// returns distinct colors, and which sizes exist under each color —
// frontend uses this to build the color swatches, then the size buttons for whichever color is picked
productSchema.methods.getVariantOptions = function () {
  const colors = this.colorVariants.map((cv) => cv.color);
  const sizesByColor = {};
  this.colorVariants.forEach((cv) => {
    sizesByColor[cv.color] = cv.sizes.map((s) => s.size);
  });

  return {
    colors,
    sizesByColor,
    hasMultipleColors: colors.length > 1, // frontend uses this to decide whether to show color swatches
  };
};

// finds the matching colorVariant, and within it the matching sizeVariant (if a size was given)
productSchema.methods.findVariant = function ({ color, size } = {}) {
  const colorVariant = this.colorVariants.find((cv) => cv.color === color);
  if (!colorVariant) return { colorVariant: null, sizeVariant: null };

  if (!size) return { colorVariant, sizeVariant: null };

  const sizeVariant = colorVariant.sizes.find((s) => s.size === size);
  return { colorVariant, sizeVariant: sizeVariant || null };
};

// calculates MRP and selling price for a specific color/size combination
// (color's priceModifier + size's priceModifier both apply, on top of base price/discountPrice)
productSchema.methods.getPriceForVariant = function ({ color, size } = {}) {
  const basePrice = this.price;
  const baseSellingPrice = this.discountPrice > 0 ? this.discountPrice : this.price;

  if (!color || this.colorVariants.length === 0) {
    return { mrp: basePrice, sellingPrice: baseSellingPrice };
  }

  const { colorVariant, sizeVariant } = this.findVariant({ color, size });
  if (!colorVariant) {
    return { mrp: basePrice, sellingPrice: baseSellingPrice };
  }

  const totalModifier = (colorVariant.priceModifier || 0) + (sizeVariant?.priceModifier || 0);

  return {
    mrp: basePrice + totalModifier,
    sellingPrice: baseSellingPrice + totalModifier,
  };
};

// returns available stock for a given color/size combination — 0 if that exact combination doesn't exist
productSchema.methods.getStockForVariant = function ({ color, size } = {}) {
  if (this.colorVariants.length === 0) return this.stock;

  const { sizeVariant } = this.findVariant({ color, size });
  return sizeVariant ? sizeVariant.stock : 0;
};

// returns the image set for a chosen color — falls back to the product's base images if that color has none
productSchema.methods.getImagesForVariant = function (color) {
  if (!color) return this.images;
  const colorVariant = this.colorVariants.find((cv) => cv.color === color);
  if (colorVariant && colorVariant.images && colorVariant.images.length > 0) {
    return colorVariant.images;
  }
  return this.images;
};

productSchema.set("toJSON", { virtuals: true });
productSchema.set("toObject", { virtuals: true });



module.exports = mongoose.model("Product", productSchema);