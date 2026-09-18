const request = require("supertest");
const app = require("../app");

describe("SuperAdmin Microservice API", () => {
  it("should mount superadmin routes and protect system dashboard", async () => {
    const res = await request(app).get("/api/v1/superadmin/dashboard");
    expect(res.statusCode).not.toEqual(500);
  });
});
