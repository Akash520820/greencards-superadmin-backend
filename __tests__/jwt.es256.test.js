const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const {
  signCustomerAccessToken,
  verifyCustomerAccessToken,
  signStaffAccessToken,
  verifyStaffAccessToken,
  signMfaChallengeToken,
  verifyMfaChallengeToken,
  calculateThumbprint,
  readKeyFromEnv,
} = require("../shared/utils/jwtKeys");

describe("ES256 Token Signing and Verification", () => {
  let customerKeys;
  let staffKeys;
  let savedEnv;

  beforeAll(() => {
    savedEnv = { ...process.env };

    customerKeys = crypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    staffKeys = crypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    process.env.CUSTOMER_JWT_PRIVATE_KEY = customerKeys.privateKey;
    process.env.CUSTOMER_JWT_PUBLIC_KEY = customerKeys.publicKey;
    process.env.STAFF_JWT_PRIVATE_KEY = staffKeys.privateKey;
    process.env.STAFF_JWT_PUBLIC_KEY = staffKeys.publicKey;
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  test("signs customer token with ES256 and correct kid, iss, aud", () => {
    const payload = { _id: "usr_12345", email: "user@test.com", role: "user" };
    const token = signCustomerAccessToken(payload);

    const decoded = jwt.decode(token, { complete: true });
    expect(decoded.header.alg).toBe("ES256");
    expect(decoded.header.kid).toBe(calculateThumbprint(customerKeys.publicKey));
    expect(decoded.payload.iss).toBe("greencards-user-backend");
    expect(decoded.payload.aud).toBe("greencards-api");
    expect(decoded.payload.email).toBe("user@test.com");
  });

  test("verifies customer token successfully with customer public key", () => {
    const payload = { _id: "usr_12345", email: "user@test.com", role: "user" };
    const token = signCustomerAccessToken(payload);

    const verified = verifyCustomerAccessToken(token);
    expect(verified._id).toBe("usr_12345");
    expect(verified.email).toBe("user@test.com");
  });

  test("signs staff token with ES256 and verifies successfully", () => {
    const payload = { _id: "stf_12345", companyEmail: "admin@greencards.com", role: "admin", isStaff: true };
    const token = signStaffAccessToken(payload);

    const decoded = jwt.decode(token, { complete: true });
    expect(decoded.header.alg).toBe("ES256");
    expect(decoded.header.kid).toBe(calculateThumbprint(staffKeys.publicKey));
    expect(decoded.payload.iss).toBe("greencards-superadmin-backend");
    expect(decoded.payload.aud).toBe("greencards-api");

    const verified = verifyStaffAccessToken(token);
    expect(verified._id).toBe("stf_12345");
    expect(verified.isStaff).toBe(true);
  });

  test("cross-domain isolation: customer token is rejected by verifyStaffAccessToken", () => {
    const customerToken = signCustomerAccessToken({ _id: "usr_attacker", role: "user" });
    expect(() => verifyStaffAccessToken(customerToken)).toThrow();
  });

  test("cross-domain isolation: staff token is rejected by verifyCustomerAccessToken", () => {
    const staffToken = signStaffAccessToken({ _id: "stf_admin", role: "admin", isStaff: true });
    expect(() => verifyCustomerAccessToken(staffToken)).toThrow();
  });

  test("rejects forged token with none algorithm or invalid signature", () => {
    const forgedHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const forgedPayload = Buffer.from(JSON.stringify({ _id: "usr_fake", iss: "greencards-user-backend", aud: "greencards-api" })).toString("base64url");
    const forgedToken = `${forgedHeader}.${forgedPayload}.`;

    expect(() => verifyCustomerAccessToken(forgedToken)).toThrow();
  });

  test("signs and verifies MFA challenge token", () => {
    const claims = { _id: "stf_mfa123", companyEmail: "superadmin@greencards.com" };
    const token = signMfaChallengeToken(claims);

    const verified = verifyMfaChallengeToken(token);
    expect(verified._id).toBe("stf_mfa123");
    expect(verified.aud).toBe("greencards-mfa-challenge");
  });
});
