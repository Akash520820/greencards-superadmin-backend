const request = require("supertest");
const app = require("../app");

describe("SuperAdmin Microservice Route & Validation Enforcement", () => {
  test("protected superadmin routes return 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/v1/superadmin/dashboard");
    expect(res.status).toBe(401);
  });
});
