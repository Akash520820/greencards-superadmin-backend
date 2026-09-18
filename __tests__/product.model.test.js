const mongoose = require("mongoose");
const Product = require("../models/product.model");

// These are pure-logic tests: we build a Product document in memory (never
// saved, no DB connection needed) and exercise its instance methods
// directly. This is exactly the kind of coverage the project report
// flagged as highest-leverage: getPriceForVariant/getStockForVariant sit
// underneath every cart, checkout, and stock-decrement calculation, so a
// silent bug here is a silent revenue/inventory bug everywhere else.

const buildProduct = (overrides = {}) =>
  new Product({
    name: "Test Tee",
    slug: "test-tee",
    description: "A test product",
    category: new mongoose.Types.ObjectId(),
    images: ["https://example.com/base.jpg"],
    price: 500,
    discountPrice: 0,
    stock: 10,
    createdBy: new mongoose.Types.ObjectId(),
    colorVariants: [],
    ...overrides,
  });

describe("Product model — no-variant products (Scenario 2)", () => {
  test("getPriceForVariant falls back to base price/discount when there are no variants", () => {
    const product = buildProduct({ price: 500, discountPrice: 400 });
    expect(product.getPriceForVariant({})).toEqual({ mrp: 500, sellingPrice: 400 });
  });

  test("getStockForVariant returns the flat stock field", () => {
    const product = buildProduct({ stock: 7 });
    expect(product.getStockForVariant({})).toBe(7);
  });

  test("getImagesForVariant with no color returns base images", () => {
    const product = buildProduct({ images: ["a.jpg", "b.jpg"] });
    expect(product.getImagesForVariant()).toEqual(["a.jpg", "b.jpg"]);
  });
});

describe("Product model — color/size variants (Scenario 1)", () => {
  const withVariants = () =>
    buildProduct({
      price: 1000,
      discountPrice: 900,
      colorVariants: [
        {
          color: "Red",
          images: ["red1.jpg"],
          priceModifier: 100, // Red costs 100 more
          sizes: [
            { size: "S", stock: 5, priceModifier: 0 },
            { size: "M", stock: 0, priceModifier: 50 }, // M is sold out
          ],
        },
        {
          color: "Blue",
          images: [],
          priceModifier: 0,
          sizes: [{ size: "S", stock: 3, priceModifier: 0 }],
        },
      ],
    });

  test("findVariant locates the right color+size combination", () => {
    const product = withVariants();
    const { colorVariant, sizeVariant } = product.findVariant({ color: "Red", size: "S" });
    expect(colorVariant.color).toBe("Red");
    expect(sizeVariant.size).toBe("S");
  });

  test("findVariant returns null sizeVariant for an unknown size", () => {
    const product = withVariants();
    const { colorVariant, sizeVariant } = product.findVariant({ color: "Red", size: "XL" });
    expect(colorVariant).not.toBeNull();
    expect(sizeVariant).toBeNull();
  });

  test("getPriceForVariant stacks the color modifier and the size modifier on top of the selling price", () => {
    const product = withVariants();
    // base sellingPrice 900 + color modifier 100 + size modifier 50 = 1050
    expect(product.getPriceForVariant({ color: "Red", size: "M" })).toEqual({
      mrp: 1000 + 100 + 50,
      sellingPrice: 900 + 100 + 50,
    });
  });

  test("getPriceForVariant with only a color modifier (size has none)", () => {
    const product = withVariants();
    expect(product.getPriceForVariant({ color: "Red", size: "S" })).toEqual({
      mrp: 1100,
      sellingPrice: 1000,
    });
  });

  test("getStockForVariant returns 0 for a sold-out size, not the color's other sizes' stock", () => {
    const product = withVariants();
    expect(product.getStockForVariant({ color: "Red", size: "M" })).toBe(0);
    expect(product.getStockForVariant({ color: "Red", size: "S" })).toBe(5);
  });

  test("getStockForVariant returns 0 for a variant combination that doesn't exist at all", () => {
    const product = withVariants();
    expect(product.getStockForVariant({ color: "Green", size: "S" })).toBe(0);
  });

  test("getImagesForVariant falls back to base images when the chosen color has none of its own", () => {
    const product = withVariants();
    expect(product.getImagesForVariant("Blue")).toEqual(product.images); // Blue has images: []
    expect(product.getImagesForVariant("Red")).toEqual(["red1.jpg"]);
  });

  test("getVariantOptions summarizes colors and their sizes for the frontend swatch UI", () => {
    const product = withVariants();
    const options = product.getVariantOptions();
    expect(options.colors).toEqual(["Red", "Blue"]);
    expect(options.hasMultipleColors).toBe(true);
    expect(options.sizesByColor.Red).toEqual(["S", "M"]);
    expect(options.sizesByColor.Blue).toEqual(["S"]);
  });
});

describe("Product model — slug generation", () => {
  test("pre-validate hook slugifies the name when no slug is set", async () => {
    const product = new Product({
      name: "Cool  Product!! #1",
      description: "desc",
      category: new mongoose.Types.ObjectId(),
      images: ["a.jpg"],
      price: 100,
      createdBy: new mongoose.Types.ObjectId(),
    });
    await product.validate().catch(() => {}); // triggers pre("validate") even if other fields fail validation
    expect(product.slug).toBe("cool-product-1");
  });
});
