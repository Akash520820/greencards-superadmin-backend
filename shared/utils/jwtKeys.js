/**
 * jwtKeys.js — ES256 (ECDSA P-256) token signing & verification.
 *
 * Two independent trust domains, two independent key pairs:
 *
 *   CUSTOMER domain  (customers + sellers)
 *     private key : user-backend ONLY            -> CUSTOMER_JWT_PRIVATE_KEY
 *     public key  : every service that verifies  -> CUSTOMER_JWT_PUBLIC_KEY
 *
 *   STAFF domain     (admin + superadmin)
 *     private key : superadmin-backend ONLY      -> STAFF_JWT_PRIVATE_KEY
 *     public key  : every service that verifies  -> STAFF_JWT_PUBLIC_KEY
 *
 * A customer token can never validate as a staff token (different key AND
 * different issuer/audience), and a compromised verifier (admin, seller,
 * gateway, ...) holds only public keys, so it cannot mint any token.
 *
 * Key format: PEM, or base64 of the PEM (recommended on Render/Docker, which
 * mangle multi-line values). Literal "\n" sequences are also accepted.
 *
 * Rotation: set <DOMAIN>_JWT_PUBLIC_KEY_PREVIOUS on verifiers. Tokens carry a
 * `kid` header (SHA-256 thumbprint of the public key) so verifiers pick the
 * right key without trying all of them. See the report for the runbook.
 */
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const ALG = "ES256";
const AUDIENCE = "greencards-api";
const MFA_AUDIENCE = "greencards-mfa-challenge";
const ISSUER = {
  customer: "greencards-user-backend",
  staff: "greencards-superadmin-backend",
};
const STAFF_ROLES = ["admin", "superadmin"];

const cache = new Map();

const toPem = (raw) => {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s.includes("-----BEGIN")) s = Buffer.from(s, "base64").toString("utf8");
  s = s.replace(/\\n/g, "\n").trim();
  return s + "\n";
};

const assertP256 = (keyObject, label) => {
  if (keyObject.asymmetricKeyType !== "ec" || keyObject.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error(`${label} must be an EC P-256 (prime256v1) key for ES256`);
  }
};

const thumbprint = (publicKeyObject) =>
  crypto
    .createHash("sha256")
    .update(publicKeyObject.export({ type: "spki", format: "der" }))
    .digest("hex")
    .slice(0, 16);

const loadPublic = (pem, label) => {
  const keyObject = crypto.createPublicKey(pem);
  assertP256(keyObject, label);
  return { pem: keyObject.export({ type: "spki", format: "pem" }), kid: thumbprint(keyObject) };
};

const loadDomain = (domain) => {
  if (cache.has(domain)) return cache.get(domain);
  const P = domain.toUpperCase();
  const out = { private: null, publicKeys: new Map(), currentKid: null };

  const privPem = toPem(process.env[`${P}_JWT_PRIVATE_KEY`]);
  if (privPem) {
    const privObj = crypto.createPrivateKey(privPem);
    assertP256(privObj, `${P}_JWT_PRIVATE_KEY`);
    const pub = loadPublic(crypto.createPublicKey(privObj).export({ type: "spki", format: "pem" }), "derived public key");
    out.private = { pem: privPem, kid: pub.kid };
    out.publicKeys.set(pub.kid, pub.pem);
    out.currentKid = pub.kid;
  }

  const pubPem = toPem(process.env[`${P}_JWT_PUBLIC_KEY`]);
  if (pubPem) {
    const pub = loadPublic(pubPem, `${P}_JWT_PUBLIC_KEY`);
    out.publicKeys.set(pub.kid, pub.pem);
    out.currentKid = out.currentKid || pub.kid;
  }
  const prevPem = toPem(process.env[`${P}_JWT_PUBLIC_KEY_PREVIOUS`]);
  if (prevPem) {
    const pub = loadPublic(prevPem, `${P}_JWT_PUBLIC_KEY_PREVIOUS`);
    out.publicKeys.set(pub.kid, pub.pem);
  }

  cache.set(domain, out);
  return out;
};

const sign = (domain, payload, { expiresIn, audience = AUDIENCE } = {}) => {
  const d = loadDomain(domain);
  if (!d.private) {
    throw new Error(`${domain.toUpperCase()}_JWT_PRIVATE_KEY is not configured — this service is not allowed to issue ${domain} tokens`);
  }
  return jwt.sign(payload, d.private.pem, {
    algorithm: ALG,
    expiresIn,
    issuer: ISSUER[domain],
    audience,
    keyid: d.private.kid,
  });
};

const verify = (domain, token, { audience = AUDIENCE } = {}) => {
  if (typeof token !== "string" || token.length > 4096) throw new jwt.JsonWebTokenError("invalid token");
  const d = loadDomain(domain);
  if (d.publicKeys.size === 0) {
    throw new Error(`${domain.toUpperCase()}_JWT_PUBLIC_KEY is not configured`);
  }
  const decodedToken = jwt.decode(token, { complete: true });
  if (!decodedToken || decodedToken.header.alg !== ALG) throw new jwt.JsonWebTokenError("invalid algorithm");
  const pem = d.publicKeys.get(decodedToken.header.kid);
  if (!pem) throw new jwt.JsonWebTokenError("unknown signing key");
  return jwt.verify(token, pem, {
    algorithms: [ALG], // hard-pinned: no alg negotiation, no "none", no HS* confusion
    issuer: ISSUER[domain],
    audience,
    clockTolerance: 5,
  });
};

// ── Customer / seller access tokens (issued by user-backend) ────────────────
const signCustomerAccessToken = (payload, expiresIn = "15m") => sign("customer", payload, { expiresIn });
const verifyCustomerAccessToken = (token) => {
  const decoded = verify("customer", token);
  if (decoded.isStaff) throw new jwt.JsonWebTokenError("staff claim on customer token");
  return decoded;
};

// ── Staff access tokens (issued by superadmin-backend) ──────────────────────
const signStaffAccessToken = (payload, expiresIn = "15m") =>
  sign("staff", { ...payload, isStaff: true }, { expiresIn });
const verifyStaffAccessToken = (token) => {
  const decoded = verify("staff", token);
  if (decoded.isStaff !== true || !STAFF_ROLES.includes(decoded.role)) {
    throw new jwt.JsonWebTokenError("not a staff token");
  }
  return decoded;
};

// ── MFA challenge (password step passed, TOTP pending). Superadmin-only ─────
const signMfaChallenge = (staffId, expiresIn = "5m") => {
  const sub = typeof staffId === "object" && staffId?._id ? String(staffId._id) : String(staffId);
  return sign("staff", { sub, purpose: "mfa" }, { expiresIn, audience: MFA_AUDIENCE });
};
const verifyMfaChallenge = (token) => {
  const decoded = verify("staff", token, { audience: MFA_AUDIENCE });
  if (decoded.purpose !== "mfa" || !decoded.sub) throw new jwt.JsonWebTokenError("not an MFA challenge");
  decoded._id = decoded.sub;
  return decoded;
};

const signMfaChallengeToken = signMfaChallenge;
const verifyMfaChallengeToken = verifyMfaChallenge;

/**
 * Call once at boot. Fails fast (process exit) with a clear message instead
 * of failing on the first login in production.
 *   issues:   ["customer"] | ["staff"] | []
 *   verifies: ["customer","staff"] ...
 */
const assertJwtConfig = (serviceName, { issues = [], verifies = [] }) => {
  const problems = [];
  const check = (fn) => { try { fn(); } catch (e) { problems.push(e.message); } };
  for (const d of issues) {
    const P = d.toUpperCase();
    if (!process.env[`${P}_JWT_PRIVATE_KEY`]) problems.push(`${P}_JWT_PRIVATE_KEY is required`);
    else check(() => loadDomain(d));
  }
  for (const d of verifies) {
    const P = d.toUpperCase();
    if (!process.env[`${P}_JWT_PUBLIC_KEY`] && !process.env[`${P}_JWT_PRIVATE_KEY`]) problems.push(`${P}_JWT_PUBLIC_KEY is required`);
    else check(() => loadDomain(d));
  }
  // least privilege: a verifier must NOT hold a private key it does not issue with
  for (const d of ["customer", "staff"]) {
    if (!issues.includes(d) && process.env[`${d.toUpperCase()}_JWT_PRIVATE_KEY`]) {
      problems.push(`${d.toUpperCase()}_JWT_PRIVATE_KEY must NOT be set on ${serviceName} (it is not the ${d} token issuer)`);
    }
  }
  if (problems.length) {
    console.error(`[${serviceName}] JWT configuration error:\n - ${problems.join("\n - ")}`);
    process.exit(1);
  }
};

const _resetCacheForTests = () => cache.clear();

const calculateThumbprint = (publicKey) => {
  const keyObj = typeof publicKey === "string" ? crypto.createPublicKey(toPem(publicKey)) : publicKey;
  return thumbprint(keyObj);
};

module.exports = {
  ALG, AUDIENCE, ISSUER, STAFF_ROLES,
  signCustomerAccessToken, verifyCustomerAccessToken,
  signStaffAccessToken, verifyStaffAccessToken,
  signMfaChallenge, verifyMfaChallenge,
  signMfaChallengeToken, verifyMfaChallengeToken,
  calculateThumbprint, thumbprint,
  assertJwtConfig, _resetCacheForTests,
};
