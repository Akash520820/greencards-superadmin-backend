const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const pair = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    priv: Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64"),
    pub: Buffer.from(publicKey.export({ type: "spki", format: "pem" })).toString("base64"),
  };
};
const k = pair();
process.env.STAFF_JWT_PRIVATE_KEY = k.priv;
process.env.STAFF_JWT_PUBLIC_KEY = k.pub;
process.env.CUSTOMER_JWT_PUBLIC_KEY = pair().pub;

const { getStaffAccessTtlSeconds } = require("../shared/utils/staffTtl");
const Staff = require("../models/staff.model");

describe("STAFF_ACCESS_TOKEN_EXPIRY", () => {
  afterEach(() => { delete process.env.STAFF_ACCESS_TOKEN_EXPIRY; });

  test.each([
    [undefined, 900],
    ["10m", 600],
    ["5m", 300],
    ["900s", 900],
    ["1h", 3600],
    ["2h", 3600],      // clamped to 1 hour
    ["10s", 60],       // clamped to 1 minute
    ["banana", 900],   // invalid -> default
    ["15", 900],       // missing unit -> default
    ["-5m", 900],      // negative -> default
  ])("value %p -> %p seconds", (value, expected) => {
    if (value !== undefined) process.env.STAFF_ACCESS_TOKEN_EXPIRY = value;
    expect(getStaffAccessTtlSeconds()).toBe(expected);
  });

  test("the staff token really expires after the configured time", () => {
    process.env.STAFF_ACCESS_TOKEN_EXPIRY = "10m";
    const staff = new Staff({ fullName: "T", companyEmail: "t@example.com", password: "x", role: "admin" });
    const decoded = jwt.decode(staff.generateAccessToken({ mfa: false }));
    expect(decoded.exp - decoded.iat).toBe(600);
  });

  test("default is 15 minutes when the variable is not set", () => {
    const staff = new Staff({ fullName: "T", companyEmail: "t@example.com", password: "x", role: "admin" });
    const decoded = jwt.decode(staff.generateAccessToken({ mfa: false }));
    expect(decoded.exp - decoded.iat).toBe(900);
  });
});
