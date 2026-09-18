const mongoose = require("mongoose");
const Product = require("../models/product.model");
const { atomicallyDecrementStock } = require("../controllers/order.controller");

// The bug this guards against: the OLD placeOrder implementation did
//   const product = await Product.findById(id);       // read
//   if (product.stock < qty) throw ...;                // check
//   product.stock -= qty; await product.save();        // write
// Two concurrent requests can both pass the "check" before either "write"
// lands — both read stock=1, both decide 1 unit is enough, both write,
// and the product ends up oversold. This is the textbook TOCTOU
// (time-of-check to time-of-use) race condition.
//
// The fix folds "is there enough stock" and "take it" into ONE atomic
// database operation via findOneAndUpdate's filter + $inc, so MongoDB
// itself (not our JS) is the thing deciding who wins a race. We can't spin
// up a live replica set in this environment to prove it end-to-end, but we
// CAN prove — by intercepting the exact call made to Mongoose — that the
// query is built the way atomicity requires: the availability check lives
// INSIDE the filter of the same call that performs the write, not in a
// separate preceding read.

describe("atomicallyDecrementStock — query shape must be race-safe", () => {
  let findOneAndUpdateSpy;

  beforeEach(() => {
    findOneAndUpdateSpy = jest.spyOn(Product, "findOneAndUpdate");
  });

  afterEach(() => {
    findOneAndUpdateSpy.mockRestore();
  });

  test("no-variant product: stock check and decrement happen in a single findOneAndUpdate call", async () => {
    const productId = new mongoose.Types.ObjectId();
    findOneAndUpdateSpy.mockResolvedValue({ _id: productId, stock: 4 });

    await atomicallyDecrementStock({ productId, quantity: 6, session: "fake-session" });

    expect(findOneAndUpdateSpy).toHaveBeenCalledTimes(1);
    const [filter, update, options] = findOneAndUpdateSpy.mock.calls[0];

    // The availability guard MUST be part of the filter (evaluated atomically
    // by the DB against the current document), never checked beforehand in JS.
    expect(filter).toMatchObject({ _id: productId, stock: { $gte: 6 } });
    expect(update).toEqual({ $inc: { stock: -6 } });
    expect(options.session).toBe("fake-session");
  });

  test("variant product: the $gte guard is on the SAME nested array element being decremented", async () => {
    const productId = new mongoose.Types.ObjectId();
    findOneAndUpdateSpy.mockResolvedValue({ _id: productId });

    await atomicallyDecrementStock({
      productId,
      color: "Red",
      size: "M",
      quantity: 2,
      session: "fake-session",
    });

    const [filter, update, options] = findOneAndUpdateSpy.mock.calls[0];

    // $elemMatch nesting ensures the SAME size sub-document is checked for
    // stock AND targeted for the decrement — not "some size of this color
    // has enough stock" while a different size gets decremented.
    expect(filter._id).toBe(productId);
    expect(filter.isActive).toBe(true);
    expect(filter.colorVariants.$elemMatch.color).toBe("Red");
    expect(filter.colorVariants.$elemMatch.sizes.$elemMatch).toMatchObject({
      size: "M",
      stock: { $gte: 2 },
    });
    expect(update).toEqual({ $inc: { "colorVariants.$[c].sizes.$[s].stock": -2 } });
    expect(options.arrayFilters).toEqual([{ "c.color": "Red" }, { "s.size": "M" }]);
  });

  test("returns null (caller must treat as 'insufficient stock') when the DB finds no matching document", async () => {
    findOneAndUpdateSpy.mockResolvedValue(null);

    const result = await atomicallyDecrementStock({
      productId: new mongoose.Types.ObjectId(),
      quantity: 100,
      session: "fake-session",
    });

    expect(result).toBeNull();
  });
});
