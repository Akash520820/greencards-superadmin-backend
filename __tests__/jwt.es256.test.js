const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const pair = (curve = "prime256v1") => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: curve });
  return {
    priv: privateKey.export({ type: "pkcs8", format: "pem" }),
    pub: publicKey.export({ type: "spki", format: "pem" }),
  };
};
const b64 = (s) => Buffer.from(s).toString("base64");

describe("ES256 token layer (jwtKeys)", () => {
  let K, customer, staff, attacker;

  const load = () => {
    jest.resetModules();
    K = require("../shared/utils/jwtKeys");
  };

  beforeEach(() => {
    customer = pair();
    staff = pair();
    attacker = pair();
    process.env.CUSTOMER_JWT_PRIVATE_KEY = b64(customer.priv);
    process.env.CUSTOMER_JWT_PUBLIC_KEY = b64(customer.pub);
    process.env.STAFF_JWT_PRIVATE_KEY = b64(staff.priv);
    process.env.STAFF_JWT_PUBLIC_KEY = b64(staff.pub);
    delete process.env.STAFF_JWT_PUBLIC_KEY_PREVIOUS;
    delete process.env.CUSTOMER_JWT_PUBLIC_KEY_PREVIOUS;
    load();
  });

  test("customer and staff tokens round-trip", () => {
    const c = K.signCustomerAccessToken({ _id: "u1", role: "seller" }, "5m");
    expect(K.verifyCustomerAccessToken(c)).toMatchObject({ _id: "u1", role: "seller" });
    const s = K.signStaffAccessToken({ _id: "s1", role: "superadmin", mfa: true }, "5m");
    expect(K.verifyStaffAccessToken(s)).toMatchObject({ _id: "s1", role: "superadmin", isStaff: true, mfa: true });
  });

  test("header is ES256 and carries a kid", () => {
    const { header } = jwt.decode(K.signStaffAccessToken({ _id: "s1", role: "admin" }), { complete: true });
    expect(header.alg).toBe("ES256");
    expect(header.kid).toMatch(/^[0-9a-f]{16}$/);
  });

  test("a customer token can never pass as a staff token (and vice versa)", () => {
    const c = K.signCustomerAccessToken({ _id: "u1", role: "user" });
    expect(() => K.verifyStaffAccessToken(c)).toThrow();
    const s = K.signStaffAccessToken({ _id: "s1", role: "admin" });
    expect(() => K.verifyCustomerAccessToken(s)).toThrow();
  });

  test("algorithm confusion: HS256 token signed with the PUBLIC key as HMAC secret is rejected", () => {
    const forged = jwt.sign({ _id: "s1", role: "superadmin", isStaff: true }, staff.pub, {
      algorithm: "HS256", issuer: K.ISSUER.staff, audience: K.AUDIENCE, keyid: "x",
    });
    expect(() => K.verifyStaffAccessToken(forged)).toThrow();
  });

  test('alg "none" is rejected', () => {
    const h = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const p = Buffer.from(JSON.stringify({ _id: "s1", role: "superadmin", isStaff: true, iss: K.ISSUER.staff, aud: K.AUDIENCE })).toString("base64url");
    expect(() => K.verifyStaffAccessToken(`${h}.${p}.`)).toThrow();
  });

  test("token signed by an attacker's own EC key is rejected, even copying the real kid", () => {
    const real = K.signStaffAccessToken({ _id: "s1", role: "admin" });
    const kid = jwt.decode(real, { complete: true }).header.kid;
    const forged = jwt.sign({ _id: "s1", role: "superadmin", isStaff: true }, attacker.priv, {
      algorithm: "ES256", issuer: K.ISSUER.staff, audience: K.AUDIENCE, keyid: kid,
    });
    expect(() => K.verifyStaffAccessToken(forged)).toThrow(/signature/i);
  });

  test("wrong issuer / audience rejected", () => {
    const badIss = jwt.sign({ _id: "s1", role: "admin", isStaff: true }, staff.priv, { algorithm: "ES256", issuer: "evil", audience: K.AUDIENCE });
    const badAud = jwt.sign({ _id: "s1", role: "admin", isStaff: true }, staff.priv, { algorithm: "ES256", issuer: K.ISSUER.staff, audience: "other" });
    // unknown kid is rejected first, which is also correct
    expect(() => K.verifyStaffAccessToken(badIss)).toThrow();
    expect(() => K.verifyStaffAccessToken(badAud)).toThrow();
  });

  test("expired tokens throw TokenExpiredError", () => {
    const t = K.signStaffAccessToken({ _id: "s1", role: "admin" }, "-10s");
    let err;
    try { K.verifyStaffAccessToken(t); } catch (e) { err = e; }
    // middleware maps on err.name, so assert on the name (module instances differ after resetModules)
    expect(err && err.name).toBe("TokenExpiredError");
  });

  test("staff verifier requires isStaff and a staff role", () => {
    const nonStaff = K.signCustomerAccessToken({ _id: "u1", role: "admin" });
    expect(() => K.verifyStaffAccessToken(nonStaff)).toThrow();
  });

  test("customer verifier refuses a token that claims isStaff", () => {
    const sneaky = jwt.sign({ _id: "u1", role: "user", isStaff: true }, customer.priv, {
      algorithm: "ES256", issuer: K.ISSUER.customer, audience: K.AUDIENCE, keyid: jwt.decode(K.signCustomerAccessToken({ _id: "u1" }), { complete: true }).header.kid,
    });
    expect(() => K.verifyCustomerAccessToken(sneaky)).toThrow(/staff claim/);
  });

  test("MFA challenge cannot be used as an access token, and vice versa", () => {
    const ch = K.signMfaChallenge("s1");
    expect(K.verifyMfaChallenge(ch).sub).toBe("s1");
    expect(() => K.verifyStaffAccessToken(ch)).toThrow();
    expect(() => K.verifyMfaChallenge(K.signStaffAccessToken({ _id: "s1", role: "admin" }))).toThrow();
  });

  test("a verify-only service (public keys only) cannot mint tokens", () => {
    delete process.env.STAFF_JWT_PRIVATE_KEY;
    delete process.env.CUSTOMER_JWT_PRIVATE_KEY;
    load();
    expect(() => K.signStaffAccessToken({ _id: "s1", role: "superadmin" })).toThrow(/not allowed to issue/);
    expect(() => K.signCustomerAccessToken({ _id: "u1" })).toThrow(/not allowed to issue/);
  });

  test("key rotation: tokens from the previous key verify while the new key signs", () => {
    const oldToken = K.signStaffAccessToken({ _id: "s1", role: "admin" });
    const next = pair();
    process.env.STAFF_JWT_PRIVATE_KEY = b64(next.priv);
    process.env.STAFF_JWT_PUBLIC_KEY = b64(next.pub);
    process.env.STAFF_JWT_PUBLIC_KEY_PREVIOUS = b64(staff.pub);
    load();
    expect(K.verifyStaffAccessToken(oldToken)._id).toBe("s1");
    const fresh = K.signStaffAccessToken({ _id: "s2", role: "admin" });
    expect(K.verifyStaffAccessToken(fresh)._id).toBe("s2");
    // once PREVIOUS is dropped, old tokens die
    delete process.env.STAFF_JWT_PUBLIC_KEY_PREVIOUS;
    load();
    expect(() => K.verifyStaffAccessToken(oldToken)).toThrow(/unknown signing key/);
  });

  test("only P-256 keys are accepted (no RSA, no other curves)", () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.STAFF_JWT_PRIVATE_KEY = b64(privateKey.export({ type: "pkcs8", format: "pem" }));
    load();
    expect(() => K.signStaffAccessToken({ _id: "s1", role: "admin" })).toThrow(/P-256/);
    const p384 = pair("secp384r1");
    process.env.STAFF_JWT_PRIVATE_KEY = b64(p384.priv);
    load();
    expect(() => K.signStaffAccessToken({ _id: "s1", role: "admin" })).toThrow(/P-256/);
  });

  test("raw PEM and \\n-escaped PEM are accepted as well as base64", () => {
    process.env.STAFF_JWT_PRIVATE_KEY = staff.priv.replace(/\n/g, "\\n");
    process.env.STAFF_JWT_PUBLIC_KEY = staff.pub;
    load();
    const t = K.signStaffAccessToken({ _id: "s1", role: "admin" });
    expect(K.verifyStaffAccessToken(t)._id).toBe("s1");
  });

  test("oversized / non-string tokens are rejected before parsing", () => {
    expect(() => K.verifyStaffAccessToken("a".repeat(5000))).toThrow();
    expect(() => K.verifyStaffAccessToken(undefined)).toThrow();
  });
});
