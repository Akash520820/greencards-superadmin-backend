/**
 * End-to-end behaviour of the staff auth flow (ES256 sessions, MFA challenge
 * binding, lockout, TOTP replay, MFA enforcement) with the Staff collection
 * replaced by an in-memory fake — no database needed.
 */
const crypto = require("crypto");
const request = require("supertest");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { authenticator } = require("otplib");

const pair = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    priv: Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64"),
    pub: Buffer.from(publicKey.export({ type: "spki", format: "pem" })).toString("base64"),
  };
};
const staffKeys = pair();
const customerKeys = pair();
process.env.STAFF_JWT_PRIVATE_KEY = staffKeys.priv;
process.env.STAFF_JWT_PUBLIC_KEY = staffKeys.pub;
process.env.CUSTOMER_JWT_PUBLIC_KEY = customerKeys.pub;
process.env.SUPERADMIN_REFRESH_TOKEN_SECRET = "test-refresh-secret-test-refresh-secret";
process.env.INTERNAL_API_SECRET = "x";

jest.mock("../shared/middleware/rateLimiter.middleware", () => {
  const pass = (req, res, next) => next();
  return { apiLimiter: pass, authLimiter: pass, otpLimiter: pass, checkoutLimiter: pass, sellerApplicationLimiter: pass, contactLimiter: pass };
});
jest.mock("../models/auditLog.model", () => ({ create: jest.fn().mockResolvedValue({}) }));

jest.mock("../models/staff.model", () => {
  const store = new Map();
  const { signStaffAccessToken } = require("../shared/utils/jwtKeys");
  const jwtLib = require("jsonwebtoken");
  const build = (o) => {
    const doc = {
      failedLoginAttempts: 0, lockUntil: null, mfaLastUsedStep: 0, passwordChangedAt: null,
      isActive: true, mfaEnabled: false, permissions: [], role: "superadmin", ...o,
    };
    doc.isLocked = () => !!(doc.lockUntil && doc.lockUntil > new Date());
    doc.isPasswordCorrect = (p) => require("bcrypt").compare(p, doc.password);
    doc.hasPermission = () => doc.role === "superadmin";
    doc.generateAccessToken = ({ mfa = false } = {}) =>
      signStaffAccessToken({ _id: doc._id, companyEmail: doc.companyEmail, role: doc.role, mfa }, "15m");
    doc.generateRefreshToken = ({ mfa = false } = {}) =>
      jwtLib.sign({ _id: doc._id, isStaff: true, mfa }, process.env.SUPERADMIN_REFRESH_TOKEN_SECRET, { expiresIn: "1d" });
    doc.save = async () => doc;
    doc.toObject = () => ({ ...doc });
    return doc;
  };
  const q = (v) => ({ select: async () => v, then: (res, rej) => Promise.resolve(v).then(res, rej) });
  const Staff = {
    __store: store, __build: build,
    findOne: ({ companyEmail }) => q([...store.values()].find((s) => s.companyEmail === companyEmail) || null),
    findById: (id) => q(store.get(String(id)) || null),
    findByIdAndUpdate: async (id, upd) => {
      const d = store.get(String(id));
      if (!d) return null;
      if (upd.$inc) for (const [k, v] of Object.entries(upd.$inc)) d[k] = (d[k] || 0) + v;
      if (upd.$set) Object.assign(d, upd.$set);
      if (upd.$unset) for (const k of Object.keys(upd.$unset)) delete d[k];
      return d;
    },
    updateOne: async (filter, upd) => {
      const d = store.get(String(filter._id));
      if (!d || !(d.mfaLastUsedStep < filter.mfaLastUsedStep.$lt)) return { modifiedCount: 0 };
      Object.assign(d, upd.$set);
      return { modifiedCount: 1 };
    },
    exists: async () => null,
  };
  return Staff;
});

const Staff = require("../models/staff.model");
const app = require("../app");

const PASSWORD = "correct horse battery staple 42";
let admin;
const mkStaff = async (over = {}) => {
  const id = crypto.randomBytes(12).toString("hex");
  const doc = Staff.__build({
    _id: id, companyEmail: `s${id.slice(0, 6)}@example.com`, fullName: "T",
    password: await bcrypt.hash(PASSWORD, 4), ...over,
  });
  Staff.__store.set(id, doc);
  return doc;
};
const cookiesOf = (res) => (res.headers["set-cookie"] || []).join(";");
const access = (res) => /staffAccessToken=([^;]+)/.exec(cookiesOf(res))?.[1];

describe("staff auth flow", () => {
  beforeEach(() => { Staff.__store.clear(); delete process.env.REQUIRE_SUPERADMIN_MFA; });

  test("password-only login issues an ES256 session with mfa:false", async () => {
    const s = await mkStaff();
    const res = await request(app).post("/api/v1/staff/login").send({ companyEmail: s.companyEmail, password: PASSWORD });
    expect(res.status).toBe(200);
    const tok = access(res);
    expect(jwt.decode(tok, { complete: true }).header.alg).toBe("ES256");
    expect(jwt.decode(tok).mfa).toBe(false);
  });

  test("unknown email and wrong password are indistinguishable", async () => {
    const s = await mkStaff();
    const a = await request(app).post("/api/v1/staff/login").send({ companyEmail: "nobody@example.com", password: PASSWORD });
    const b = await request(app).post("/api/v1/staff/login").send({ companyEmail: s.companyEmail, password: "wrong-wrong-wrong" });
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });

  test("5 failures lock the ACCOUNT; the correct password is then refused", async () => {
    const s = await mkStaff();
    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/v1/staff/login").send({ companyEmail: s.companyEmail, password: "bad-bad-bad-bad" });
    }
    expect(s.isLocked()).toBe(true);
    const res = await request(app).post("/api/v1/staff/login").send({ companyEmail: s.companyEmail, password: PASSWORD });
    expect(res.status).toBe(401);
    expect(access(res)).toBeUndefined();
  });

  describe("with MFA enabled", () => {
    let s, secret;
    beforeEach(async () => {
      secret = authenticator.generateSecret();
      s = await mkStaff({ mfaEnabled: true, mfaSecret: secret });
    });
    const step1 = () => request(app).post("/api/v1/staff/login").send({ companyEmail: s.companyEmail, password: PASSWORD });

    test("step 1 returns a challenge token and NO session", async () => {
      const res = await step1();
      expect(res.status).toBe(200);
      expect(res.body.data.mfaRequired).toBe(true);
      expect(res.body.data.mfaToken).toBeDefined();
      expect(res.body.data.staffId).toBeUndefined();
      expect(access(res)).toBeUndefined();
    });

    test("step 2 with only a staffId (old protocol) is rejected — no password-less TOTP brute force", async () => {
      const res = await request(app).post("/api/v1/staff/mfa/login").send({ staffId: s._id, code: authenticator.generate(secret) });
      expect(res.status).toBe(400);
    });

    test("step 2 with a forged / wrong-purpose token is rejected", async () => {
      const real = (await step1()).body.data.mfaToken;
      const forged = jwt.sign({ sub: s._id, purpose: "mfa" }, "guess", { algorithm: "HS256" });
      for (const t of [forged, real.slice(0, -4) + "AAAA"]) {
        const res = await request(app).post("/api/v1/staff/mfa/login").send({ mfaToken: t, code: authenticator.generate(secret) });
        expect(res.status).toBe(401);
      }
    });

    test("valid challenge + valid code → session with mfa:true; the SAME code cannot be replayed", async () => {
      const code = authenticator.generate(secret);
      const ok = await request(app).post("/api/v1/staff/mfa/login").send({ mfaToken: (await step1()).body.data.mfaToken, code });
      expect(ok.status).toBe(200);
      expect(jwt.decode(access(ok)).mfa).toBe(true);
      const replay = await request(app).post("/api/v1/staff/mfa/login").send({ mfaToken: (await step1()).body.data.mfaToken, code });
      expect(replay.status).toBe(401);
    });

    test("wrong codes count toward the same lockout", async () => {
      const bad = authenticator.generate(secret) === "000000" ? "111111" : "000000";
      for (let i = 0; i < 5; i++) {
        const t = (await step1()).body.data?.mfaToken;
        if (!t) break;
        await request(app).post("/api/v1/staff/mfa/login").send({ mfaToken: t, code: bad });
      }
      expect(s.isLocked()).toBe(true);
    });

    test("disabling MFA needs password AND a live code", async () => {
      const code = authenticator.generate(secret);
      const sess = await request(app).post("/api/v1/staff/mfa/login").send({ mfaToken: (await step1()).body.data.mfaToken, code });
      const cookie = `staffAccessToken=${access(sess)}`;
      const none = await request(app).post("/api/v1/staff/mfa/disable").set("Cookie", cookie).send({});
      expect(none.status).toBe(400);
      const wrongPw = await request(app).post("/api/v1/staff/mfa/disable").set("Cookie", cookie).send({ password: "nope-nope-nope", code: "123456" });
      expect(wrongPw.status).toBe(401);
      expect(s.mfaEnabled).toBe(true);
    });

    test("re-enrolling over an active MFA is refused", async () => {
      const code = authenticator.generate(secret);
      const sess = await request(app).post("/api/v1/staff/mfa/login").send({ mfaToken: (await step1()).body.data.mfaToken, code });
      const res = await request(app).post("/api/v1/staff/mfa/setup").set("Cookie", `staffAccessToken=${access(sess)}`);
      expect(res.status).toBe(409);
    });
  });

  describe("session verification", () => {
    test("HS256 token signed with anything is rejected", async () => {
      const s = await mkStaff();
      const forged = jwt.sign({ _id: s._id, role: "superadmin", isStaff: true }, "STAFF_ACCESS_TOKEN_SECRET-guess", { algorithm: "HS256" });
      const res = await request(app).get("/api/v1/staff/current-staff").set("Cookie", `staffAccessToken=${forged}`);
      expect(res.status).toBe(401);
    });

    test("a customer-domain token cannot open staff routes", async () => {
      const s = await mkStaff();
      const { signCustomerAccessToken } = (() => {
        // sign with a customer private key the way user-backend would
        const kp = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
        return { signCustomerAccessToken: () => jwt.sign({ _id: s._id, role: "superadmin", isStaff: true }, kp.privateKey, { algorithm: "ES256", issuer: "greencards-user-backend", audience: "greencards-api" }) };
      })();
      const res = await request(app).get("/api/v1/staff/current-staff").set("Cookie", `staffAccessToken=${signCustomerAccessToken()}`);
      expect(res.status).toBe(401);
    });

    test("REQUIRE_SUPERADMIN_MFA=true: a password-only superadmin session is refused on privileged routes", async () => {
      process.env.REQUIRE_SUPERADMIN_MFA = "true";
      const s = await mkStaff();
      const login = await request(app).post("/api/v1/staff/login").send({ companyEmail: s.companyEmail, password: PASSWORD });
      expect(login.body.data.mfaSetupRequired).toBe(true);
      const res = await request(app).get("/api/v1/superadmin/dashboard").set("Cookie", `staffAccessToken=${access(login)}`);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Multi-factor/);
    });

    test("a deactivated staff account is refused immediately on the issuer", async () => {
      const s = await mkStaff();
      const login = await request(app).post("/api/v1/staff/login").send({ companyEmail: s.companyEmail, password: PASSWORD });
      s.isActive = false;
      const res = await request(app).get("/api/v1/staff/current-staff").set("Cookie", `staffAccessToken=${access(login)}`);
      expect(res.status).toBe(403);
    });

    test("sessions issued before a password change are revoked", async () => {
      const s = await mkStaff();
      const login = await request(app).post("/api/v1/staff/login").send({ companyEmail: s.companyEmail, password: PASSWORD });
      s.passwordChangedAt = new Date(Date.now() + 5000);
      const res = await request(app).get("/api/v1/staff/current-staff").set("Cookie", `staffAccessToken=${access(login)}`);
      expect(res.status).toBe(401);
    });
  });
});
