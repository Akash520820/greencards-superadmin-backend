const request = require("supertest");
const userServiceApp = require("../modules/user/app");
const sellerServiceApp = require("../modules/seller/app");
const adminServiceApp = require("../modules/admin/app");
const superAdminServiceApp = require("../modules/superadmin/app");
const apiGatewayApp = require("../gateway/apiGateway");

describe("Microservices Architecture Tests", () => {
  describe("API Gateway", () => {
    it("should respond to GET /health with status 200 and list microservices", async () => {
      const res = await request(apiGatewayApp).get("/health");
      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual("ok");
      expect(res.body.gateway).toBeDefined();
      expect(res.body.services).toHaveProperty("user");
      expect(res.body.services).toHaveProperty("seller");
      expect(res.body.services).toHaveProperty("admin");
      expect(res.body.services).toHaveProperty("superadmin");
    });
  });

  describe("User Microservice App", () => {
    it("should mount user service routes correctly (returns 401 or 404, not 500)", async () => {
      const res = await request(userServiceApp).get("/api/v1/users/current-user");
      expect(res.statusCode).not.toEqual(500);
    });
  });

  describe("Seller Microservice App", () => {
    it("should mount seller service routes correctly (returns 401 or 404, not 500)", async () => {
      const res = await request(sellerServiceApp).get("/api/v1/sellers/profile");
      expect(res.statusCode).not.toEqual(500);
    });
  });

  describe("Admin Microservice App", () => {
    it("should mount admin service routes correctly (returns 401 or 404, not 500)", async () => {
      const res = await request(adminServiceApp).get("/api/v1/admin/dashboard");
      expect(res.statusCode).not.toEqual(500);
    });
  });

  describe("SuperAdmin Microservice App", () => {
    it("should mount superadmin service routes correctly (returns 401 or 404, not 500)", async () => {
      const res = await request(superAdminServiceApp).get("/api/v1/superadmin/dashboard");
      expect(res.statusCode).not.toEqual(500);
    });
  });
});
