const request = require("supertest");
const app = require("../app");

describe("greencards-superadmin-backend Microservice Test", () => {
  it("should mount service routes correctly (returns non-500 status)", async () => {
    const res = await request(app).get("/api/v1/superadmin/dashboard");
    expect(res.statusCode).not.toEqual(500);
  });
});
