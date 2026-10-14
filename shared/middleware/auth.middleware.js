const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const User = require("../../models/user.model");
const Staff = require("../../models/staff.model");
const { logAudit } = require("../utils/auditLog.util");

// ---------------------------------------------------------------------
// verifyJWT — now aware of TWO completely separate identity systems:
//
//   1. Customer/seller accounts (User collection, "accessToken" cookie,
//      ES256, signed by user-backend's CUSTOMER private key)
//   2. Staff accounts (Staff collection, "staffAccessToken" cookie,
//      ES256, signed by superadmin-backend's STAFF private key — a
//      completely different key pair AND issuer, so a customer token is
//      cryptographically incapable of passing as a staff token)
//
// It checks for the staff cookie first. Whichever one is found, it sets
// req.user to the resulting document (so every existing controller that
// reads req.user._id / req.user.role keeps working unchanged) AND sets
// req.staff / req.isStaff for code that specifically needs to know it's
// dealing with a staff session (audit logging, permission checks).
const { verifyStaffAccessToken, verifyCustomerAccessToken } = require("../utils/jwtKeys");

// ES256 only. Staff tokens are verified with the STAFF *public* key and
// customer/seller tokens with the CUSTOMER *public* key, so this service can
// read sessions but can never mint one. No shared secrets, no secret fallback
// chain, no algorithm negotiation (see utils/jwtKeys.js).
const verifyStaffToken = (token) => verifyStaffAccessToken(token);

// Password change / reset revokes every session issued before it.
const rejectIfSessionPredatesPasswordChange = (staff, decoded) => {
  if (staff.passwordChangedAt && decoded.iat < Math.floor(staff.passwordChangedAt.getTime() / 1000)) {
    throw new ApiError(401, "Session expired — please sign in again");
  }
};

const verifyJWT = asyncHandler(async (req, res, next) => {
  let staffToken = req.cookies?.staffAccessToken || req.cookies?.adminAccessToken;
  if (!staffToken) {
    const authHeader = req.header("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const candidate = authHeader.replace("Bearer ", "").trim();
      try {
        verifyStaffToken(candidate);
        staffToken = candidate;
      } catch (e) {
        // Not a staff token
      }
    }
  }
  const customerToken =
    req.cookies?.accessToken || req.header("Authorization")?.replace("Bearer ", "");

  if (staffToken) {
    let decoded;
    try {
      decoded = verifyStaffToken(staffToken);
    } catch (err) {
      throw new ApiError(401, err.name === "TokenExpiredError" ? "Access token expired" : "Invalid access token");
    }
    const staff = await Staff.findById(decoded._id).select("-password -refreshToken -mfaSecret");
    if (!staff) {
      throw new ApiError(401, "Invalid access token");
    }
    if (!staff.isActive) {
      throw new ApiError(403, "Your staff account has been deactivated");
    }

    rejectIfSessionPredatesPasswordChange(staff, decoded);
    await applyJitExpiry(staff);

    req.user = staff;
    req.staff = staff;
    req.isStaff = true;
    req.tokenClaims = decoded;
    return next();
  }

  if (!customerToken) {
    throw new ApiError(401, "Unauthorized request");
  }

  let decoded;
  try {
    decoded = verifyCustomerAccessToken(customerToken);
  } catch (err) {
    throw new ApiError(401, err.name === "TokenExpiredError" ? "Access token expired" : "Invalid access token");
  }
  const user = await User.findById(decoded._id).select("-password -refreshToken");
  if (!user) {
    throw new ApiError(401, "Invalid access token");
  }
  if (!user.isActive) {
    throw new ApiError(403, "Your account has been deactivated");
  }

  req.user = user;
  req.isStaff = false;
  next();
});

// Strict variant for routes that must ONLY ever accept a staff session
// (staff management, audit logs, access requests) — rejects even a
// technically-valid customer session outright rather than falling through
// to a role check that a customer could never satisfy anyway. Defense in
// depth: this route class should never even attempt to read the User
// collection.
const verifyStaffJWT = asyncHandler(async (req, res, next) => {
  let staffToken = req.cookies?.staffAccessToken || req.cookies?.adminAccessToken;
  if (!staffToken) {
    const authHeader = req.header("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      staffToken = authHeader.replace("Bearer ", "").trim();
    }
  }
  if (!staffToken) {
    throw new ApiError(401, "Staff authentication required");
  }

  let decoded;
  try {
    decoded = verifyStaffToken(staffToken);
  } catch (err) {
    throw new ApiError(401, err.name === "TokenExpiredError" ? "Access token expired" : "Invalid access token");
  }
  const staff = await Staff.findById(decoded._id).select("-password -refreshToken -mfaSecret");
  if (!staff) {
    throw new ApiError(401, "Invalid access token");
  }
  if (!staff.isActive) {
    throw new ApiError(403, "Your staff account has been deactivated");
  }

  rejectIfSessionPredatesPasswordChange(staff, decoded);
  await applyJitExpiry(staff);

  req.user = staff;
  req.staff = staff;
  req.isStaff = true;
  req.tokenClaims = decoded;
  next();
});

// Just-in-time elevation & time-limited admin access:
// If a temporary elevation window or time-limited access has passed:
// - If previousRole exists (e.g. elevated user/admin), revert to previousRole.
// - If no previousRole (e.g. direct time-limited admin), deactivate the account.
const applyJitExpiry = async (staff) => {
  if (staff.roleExpiresAt && staff.roleExpiresAt < new Date()) {
    if (staff.previousRole) {
      const revertedFrom = staff.role;
      staff.role = staff.previousRole;
      staff.previousRole = null;
      staff.roleExpiresAt = null;
      await staff.save({ validateBeforeSave: false });
      await logAudit(staff, "role.jit_expired", { type: "Staff", id: staff._id }, { revertedFrom, revertedTo: staff.role });
    } else {
      staff.isActive = false;
      await staff.save({ validateBeforeSave: false });
      await logAudit(staff, "staff.account_expired", { type: "Staff", id: staff._id }, { expiredAt: staff.roleExpiresAt });
      throw new ApiError(403, "Your admin access duration has expired. Please contact a superadmin.");
    }
  }
};

// restricts route to admin role only — use AFTER verifyJWT
// Super Admin sits above Admin (same as Amazon/Flipkart's staff hierarchy),
// so anywhere an Admin can go, a Super Admin can go too.
const verifyAdmin = asyncHandler(async (req, res, next) => {
  if (req.user?.role !== "admin" && req.user?.role !== "superadmin") {
    throw new ApiError(403, "Access denied — admin only");
  }
  next();
});

const verifySuperAdmin = asyncHandler(async (req, res, next) => {
  if (req.user?.role !== "superadmin") {
    throw new ApiError(403, "Access denied — super admin only");
  }
  if (process.env.REQUIRE_SUPERADMIN_MFA === "true" && req.tokenClaims?.mfa !== true) {
    throw new ApiError(403, "Multi-factor authentication required for superadmin actions");
  }
  next();
});

// Fine-grained RBAC (Phase 3) — use AFTER verifyJWT/verifyStaffJWT.
// Superadmin always passes (Staff.hasPermission encodes that). A regular
// admin only passes if this specific permission was explicitly granted.
const verifyPermission = (permission) =>
  asyncHandler(async (req, res, next) => {
    if (!req.isStaff || typeof req.user?.hasPermission !== "function") {
      throw new ApiError(403, "Access denied — staff only");
    }
    if (req.user.role === "superadmin" && process.env.REQUIRE_SUPERADMIN_MFA === "true" && req.tokenClaims?.mfa !== true) {
      throw new ApiError(403, "Multi-factor authentication required for superadmin actions");
    }
    if (!req.user.hasPermission(permission)) {
      throw new ApiError(403, `Access denied — missing permission: ${permission}`);
    }
    next();
  });

// restricts route to approved sellers only — use AFTER verifyJWT
const verifySeller = asyncHandler(async (req, res, next) => {
  if (req.user?.role !== "seller") {
    throw new ApiError(403, "Access denied — seller only");
  }
  next();
});

// product management routes are shared between sellers (their own products)
// and staff (any product) — use AFTER verifyJWT, ownership itself is checked
// inside the controller since this middleware only knows the role, not the resource
const verifySellerOrAdmin = asyncHandler(async (req, res, next) => {
  const allowedRoles = ["seller", "admin", "superadmin"];
  if (!allowedRoles.includes(req.user?.role)) {
    throw new ApiError(403, "Access denied — seller or admin only");
  }
  next();
});

module.exports = {
  applyJitExpiry,
  verifyJWT,
  verifyStaffJWT,
  verifyAdmin,
  verifySuperAdmin,
  verifyPermission,
  verifySeller,
  verifySellerOrAdmin,
};
