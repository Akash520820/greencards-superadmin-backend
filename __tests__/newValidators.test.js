const express = require("express");
const request = require("supertest");
const validate = require("../shared/middleware/validate.middleware");
const errorHandler = require("../shared/middleware/errorHandler.middleware");

const { addToCartSchema } = require("../validators/cart.validators");
const { addToWishlistSchema } = require("../validators/wishlist.validators");
const { createCategorySchema } = require("../validators/category.validators");
const { createReviewSchema } = require("../validators/review.validators");
const { createReturnSchema } = require("../validators/return.validators");
const { applyForSellerSchema } = require("../validators/seller.validators");
const { staffLoginSchema } = require("../validators/staff.validators");
const { createAccessRequestSchema } = require("../validators/accessRequest.validators");

// These 8 resources are all behind verifyJWT (and most also behind
// verifyAdmin/verifySeller/verifySuperAdmin), so exercising them through
// the real app without a live database and a real logged-in user would
// only ever prove "401 before validation runs" — useful, but it can't
// prove the SCHEMAS themselves are correct. Instead we mount each schema
// on a bare-bones Express app with no auth at all and hit it directly:
// this isolates exactly what changed (the validator) from everything it
// normally sits behind.
const appFor = (schema, part = "body") => {
  const app = express();
  app.use(express.json());
  app.post("/test", validate({ [part]: schema }), (req, res) => res.status(200).json({ ok: true }));
  app.use(errorHandler);
  return app;
};

const validObjectId = "507f1f77bcf86cd799439011";

describe("New validator schemas — cart", () => {
  const app = appFor(addToCartSchema);
  test("rejects a missing productId", async () => {
    const res = await request(app).post("/test").send({ quantity: 1 });
    expect(res.status).toBe(400);
  });
  test("accepts a valid productId with no quantity (controller defaults it to 1)", async () => {
    const res = await request(app).post("/test").send({ productId: validObjectId });
    expect(res.status).toBe(200);
  });
});

describe("New validator schemas — wishlist", () => {
  const app = appFor(addToWishlistSchema);
  test("rejects a malformed ObjectId", async () => {
    const res = await request(app).post("/test").send({ productId: "not-an-id" });
    expect(res.status).toBe(400);
  });
  test("accepts a valid ObjectId", async () => {
    const res = await request(app).post("/test").send({ productId: validObjectId });
    expect(res.status).toBe(200);
  });
});

describe("New validator schemas — category", () => {
  const app = appFor(createCategorySchema);
  test("rejects a missing name", async () => {
    const res = await request(app).post("/test").send({ description: "no name given" });
    expect(res.status).toBe(400);
  });
  test("accepts a name with an empty-string parentCategory (multipart 'no parent' case)", async () => {
    const res = await request(app).post("/test").send({ name: "Electronics", parentCategory: "" });
    expect(res.status).toBe(200);
  });
});

describe("New validator schemas — review", () => {
  const app = appFor(createReviewSchema);
  test("rejects a rating above 5", async () => {
    const res = await request(app)
      .post("/test")
      .send({ productId: validObjectId, orderId: validObjectId, rating: 6 });
    expect(res.status).toBe(400);
  });
  test("rejects a rating of 0", async () => {
    const res = await request(app)
      .post("/test")
      .send({ productId: validObjectId, orderId: validObjectId, rating: 0 });
    expect(res.status).toBe(400);
  });
  test("accepts a valid rating of 5 with a comment", async () => {
    const res = await request(app)
      .post("/test")
      .send({ productId: validObjectId, orderId: validObjectId, rating: 5, comment: "Great!" });
    expect(res.status).toBe(200);
  });
});

describe("New validator schemas — return", () => {
  const app = appFor(createReturnSchema);
  test("rejects a request with no reason", async () => {
    const res = await request(app)
      .post("/test")
      .send({ orderId: validObjectId, items: [{ productId: validObjectId, quantity: 1 }] });
    expect(res.status).toBe(400);
  });
  test("rejects an empty items array", async () => {
    const res = await request(app)
      .post("/test")
      .send({ orderId: validObjectId, items: [], reason: "Wrong size" });
    expect(res.status).toBe(400);
  });
  test("accepts a well-formed return request", async () => {
    const res = await request(app)
      .post("/test")
      .send({
        orderId: validObjectId,
        items: [{ productId: validObjectId, quantity: 1, variant: { color: "Red", size: "M" } }],
        reason: "Wrong size",
      });
    expect(res.status).toBe(200);
  });
});

describe("New validator schemas — seller application", () => {
  const app = appFor(applyForSellerSchema);
  const validBase = {
    businessName: "Akash Traders",
    gstNumber: "22AAAAA0000A1Z5",
    accountHolderName: "Akash",
    accountNumber: "123456789012",
    bankName: "State Bank",
    bankBranch: "Agartala",
  };

  test("rejects a malformed IFSC code", async () => {
    const res = await request(app).post("/test").send({ ...validBase, ifscCode: "NOTVALID" });
    expect(res.status).toBe(400);
  });
  test("accepts a valid IFSC code (case-insensitive, gets uppercased)", async () => {
    const res = await request(app).post("/test").send({ ...validBase, ifscCode: "sbin0001234" });
    expect(res.status).toBe(200);
  });
  test("rejects a non-numeric account number", async () => {
    const res = await request(app).post("/test").send({ ...validBase, ifscCode: "SBIN0001234", accountNumber: "abc" });
    expect(res.status).toBe(400);
  });
  test("rejects a missing GSTIN — now required, not optional", async () => {
    const { gstNumber, ...withoutGst } = validBase;
    const res = await request(app).post("/test").send({ ...withoutGst, ifscCode: "SBIN0001234" });
    expect(res.status).toBe(400);
  });
  test("rejects a malformed GSTIN", async () => {
    const res = await request(app)
      .post("/test")
      .send({ ...validBase, ifscCode: "SBIN0001234", gstNumber: "not-a-gstin" });
    expect(res.status).toBe(400);
  });
});

describe("New validator schemas — staff login", () => {
  const app = appFor(staffLoginSchema);
  test("rejects a non-email companyEmail", async () => {
    const res = await request(app).post("/test").send({ companyEmail: "not-an-email", password: "x" });
    expect(res.status).toBe(400);
  });
  test("accepts a valid login payload", async () => {
    const res = await request(app)
      .post("/test")
      .send({ companyEmail: "staff@greencards-staff.com", password: "correcthorsebatterystaple" });
    expect(res.status).toBe(200);
  });
});

describe("New validator schemas — access request (create_staff)", () => {
  const app = appFor(createAccessRequestSchema);
  test("rejects an invalid requestedRole", async () => {
    const res = await request(app).post("/test").send({
      type: "create_staff",
      targetEmail: "new.hire@greencards-staff.com",
      targetFullName: "New Hire",
      requestedRole: "user", // not a valid staff role — staff is admin/superadmin only
      reason: "Need another admin for order support",
    });
    expect(res.status).toBe(400);
  });
  test("accepts a valid create_staff request", async () => {
    const res = await request(app).post("/test").send({
      type: "create_staff",
      targetEmail: "new.hire@greencards-staff.com",
      targetFullName: "New Hire",
      requestedRole: "admin",
      reason: "Need another admin for order support",
    });
    expect(res.status).toBe(200);
  });
});
