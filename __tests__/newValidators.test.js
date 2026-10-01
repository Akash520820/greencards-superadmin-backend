const express = require("express");
const request = require("supertest");
const validate = require("../shared/middleware/validate.middleware");
const errorHandler = require("../shared/middleware/errorHandler.middleware");

const { staffLoginSchema } = require("../validators/staff.validators");
const { createAccessRequestSchema } = require("../validators/accessRequest.validators");

const appFor = (schema, part = "body") => {
  const app = express();
  app.use(express.json());
  app.post("/test", validate({ [part]: schema }), (req, res) => res.status(200).json({ ok: true }));
  app.use(errorHandler);
  return app;
};

describe("SuperAdmin validator schemas — staff login", () => {
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

describe("SuperAdmin validator schemas — access request (create_staff)", () => {
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
