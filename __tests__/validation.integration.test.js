const request = require("supertest");
const app = require("../app");

// These hit the real Express app (routing + middleware stack) without a
// database — every case here should be rejected by validate() before the
// controller ever runs a DB query, which is exactly what we're checking:
// bad input never reaches business logic.

describe("Input validation is actually enforced on real requests", () => {
  test("POST /api/v1/users/register rejects an invalid email with 400, not a DB error", async () => {
    const res = await request(app).post("/api/v1/users/register").send({
      userName: "akash",
      email: "not-an-email",
      fullName: "Akash",
      password: "password123",
      phone: "9876543210",
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("POST /api/v1/users/register rejects a too-short password", async () => {
    const res = await request(app).post("/api/v1/users/register").send({
      userName: "akash",
      email: "akash@example.com",
      fullName: "Akash",
      password: "short",
      phone: "9876543210",
    });

    expect(res.status).toBe(400);
  });

  test("POST /api/v1/users/register rejects a malformed Indian phone number", async () => {
    const res = await request(app).post("/api/v1/users/register").send({
      userName: "akash",
      email: "akash@example.com",
      fullName: "Akash",
      password: "password123",
      phone: "12345", // too short, and doesn't start 6-9
    });

    expect(res.status).toBe(400);
  });

  test("POST /api/v1/users/login requires a password", async () => {
    const res = await request(app).post("/api/v1/users/login").send({ email: "akash@example.com" });
    expect(res.status).toBe(400);
  });

  test("POST /api/v1/users/login requires either email or userName", async () => {
    const res = await request(app).post("/api/v1/users/login").send({ password: "password123" });
    expect(res.status).toBe(400);
  });

  test("protected routes (e.g. place order) still 401 before validation even matters, when unauthenticated", async () => {
    // verifyJWT runs before validate() on this router — confirms
    // middleware ORDER wasn't accidentally changed by adding validation.
    const res = await request(app).post("/api/v1/orders").send({});
    expect(res.status).toBe(401);
  });
});
