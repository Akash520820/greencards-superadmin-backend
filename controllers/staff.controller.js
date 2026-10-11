const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { authenticator } = require("otplib");
const QRCode = require("qrcode");
const asyncHandler = require("../shared/utils/asyncHandler");
const ApiError = require("../shared/utils/ApiError");
const ApiResponse = require("../shared/utils/ApiResponse");
const Staff = require("../models/staff.model");
const AuditLog = require("../models/auditLog.model");
const { logAudit } = require("../shared/utils/auditLog.util");
const { DEFAULT_ADMIN_PERMISSIONS } = require("../shared/constants/permissions");
const {
  signMfaChallengeToken,
  verifyMfaChallengeToken,
} = require("../shared/utils/jwtKeys");

const baseStaffCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "none",
};

// maxAge (ms) MUST be kept in sync with STAFF_ACCESS_TOKEN_EXPIRY /
// STAFF_REFRESH_TOKEN_EXPIRY in .env (currently 15m / 1d). Without maxAge,
// these are SESSION cookies and get wiped when the browser fully closes,
// even though the JWT itself is still valid server-side.
const staffAccessCookieOptions = { ...baseStaffCookieOptions, maxAge: 15 * 60 * 1000 }; // 15 minutes
const staffRefreshCookieOptions = { ...baseStaffCookieOptions, maxAge: 24 * 60 * 60 * 1000 }; // 1 day

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const DUMMY_HASH = "$2b$12$e8sV1gXq/8xW5G7H6Z3J2.uY9uUq9nJ6hG6ZqL3a6mR9jM1oU9YXe";

const recordFailedLogin = async (staff, req, reason) => {
  if (!staff) return;
  staff.failedLoginAttempts = (staff.failedLoginAttempts || 0) + 1;
  const reachedLockout = staff.failedLoginAttempts >= MAX_FAILED_ATTEMPTS;
  if (reachedLockout) {
    staff.lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
  }
  await staff.save({ validateBeforeSave: false });

  await logAudit(
    staff,
    reachedLockout ? "staff.account_locked" : "staff.login_failed",
    { type: "Staff", id: staff._id },
    { reason, failedAttempts: staff.failedLoginAttempts, lockUntil: staff.lockUntil },
    req
  );
};

const resetFailedAttempts = async (staff) => {
  if (staff.failedLoginAttempts > 0 || staff.lockUntil) {
    staff.failedLoginAttempts = 0;
    staff.lockUntil = null;
    await staff.save({ validateBeforeSave: false });
  }
};

const generateStaffTokens = async (staffId, extraClaims = {}) => {
  const staff = await Staff.findById(staffId);
  const accessToken = staff.generateAccessToken(extraClaims);
  const refreshToken = staff.generateRefreshToken(extraClaims);

  staff.refreshToken = refreshToken;
  await staff.save({ validateBeforeSave: false });

  return { accessToken, refreshToken };
};

// ---- STEP 1: password login ----
const loginStaff = asyncHandler(async (req, res) => {
  const { companyEmail, password } = req.body;

  const staff = await Staff.findOne({ companyEmail }).select(
    "+password +mfaSecret"
  );

  if (!staff) {
    await bcrypt.compare(password, DUMMY_HASH);
    await logAudit(
      { _id: null, companyEmail },
      "staff.login_failed",
      { type: "Staff" },
      { reason: "invalid credentials" },
      req
    );
    throw new ApiError(401, "Invalid credentials");
  }

  if (staff.isLocked) {
    await bcrypt.compare(password, DUMMY_HASH);
    await logAudit(
      staff,
      "staff.login_locked",
      { type: "Staff", id: staff._id },
      { reason: "account locked" },
      req
    );
    throw new ApiError(401, "Invalid credentials");
  }

  const passwordValid = await staff.isPasswordCorrect(password);
  if (!passwordValid) {
    await recordFailedLogin(staff, req, "invalid password");
    throw new ApiError(401, "Invalid credentials");
  }

  if (!staff.isActive) {
    throw new ApiError(403, "Your staff account has been deactivated");
  }

  // If MFA is enabled on this staff member
  if (staff.mfaEnabled) {
    const mfaToken = signMfaChallengeToken({
      _id: String(staff._id),
      companyEmail: staff.companyEmail,
      role: staff.role,
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          mfaRequired: true,
          staffId: staff._id,
          mfaToken,
        },
        "MFA code required"
      )
    );
  }

  // If superadmin MFA is enforced globally and not set up yet
  if (staff.role === "superadmin" && process.env.REQUIRE_SUPERADMIN_MFA === "true") {
    // Generate a setup token or require setup
    const mfaToken = signMfaChallengeToken({
      _id: String(staff._id),
      companyEmail: staff.companyEmail,
      role: staff.role,
    });
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          mfaRequired: true,
          mfaSetupRequired: true,
          staffId: staff._id,
          mfaToken,
        },
        "MFA setup required for superadmin account"
      )
    );
  }

  await resetFailedAttempts(staff);

  const { accessToken, refreshToken } = await generateStaffTokens(staff._id, {
    mfa: false,
  });

  staff.lastLoginAt = new Date();
  staff.lastLoginIp = req.ip;
  await staff.save({ validateBeforeSave: false });

  const loggedInStaff = staff.toObject();
  delete loggedInStaff.password;
  delete loggedInStaff.refreshToken;
  delete loggedInStaff.mfaSecret;

  await logAudit(staff, "staff.login", { type: "Staff", id: staff._id }, {}, req);

  return res
    .status(200)
    .cookie("staffAccessToken", accessToken, staffAccessCookieOptions)
    .cookie("staffRefreshToken", refreshToken, staffRefreshCookieOptions)
    .json(new ApiResponse(200, { staff: loggedInStaff }, "Logged in successfully"));
});

// ---- STEP 2: TOTP verification ----
const verifyMfaLogin = asyncHandler(async (req, res) => {
  const { staffId, mfaToken, code } = req.body;

  let resolvedStaffId = staffId;
  if (mfaToken) {
    try {
      const claims = verifyMfaChallengeToken(mfaToken);
      resolvedStaffId = claims._id;
    } catch (err) {
      throw new ApiError(401, "MFA challenge expired or invalid — please sign in again");
    }
  }

  const staff = await Staff.findById(resolvedStaffId).select("+mfaSecret");
  if (!staff) {
    throw new ApiError(401, "Invalid request");
  }

  if (staff.isLocked) {
    throw new ApiError(401, "Account is locked — please try again later");
  }

  if (!staff.mfaEnabled || !staff.mfaSecret) {
    throw new ApiError(400, "MFA is not enabled for this account");
  }

  // TOTP replay protection: check window step
  const step = Math.floor(Date.now() / 30000);
  const valid = authenticator.check(code, staff.mfaSecret);
  if (!valid || (staff.mfaLastUsedStep && staff.mfaLastUsedStep >= step)) {
    await recordFailedLogin(staff, req, "invalid or replayed MFA code");
    throw new ApiError(401, "Invalid or expired MFA code");
  }

  staff.mfaLastUsedStep = step;
  await resetFailedAttempts(staff);

  const { accessToken, refreshToken } = await generateStaffTokens(staff._id, {
    mfa: true,
  });

  staff.lastLoginAt = new Date();
  staff.lastLoginIp = req.ip;
  await staff.save({ validateBeforeSave: false });

  const loggedInStaff = staff.toObject();
  delete loggedInStaff.password;
  delete loggedInStaff.refreshToken;
  delete loggedInStaff.mfaSecret;

  await logAudit(staff, "staff.login", { type: "Staff", id: staff._id }, { mfa: true }, req);

  return res
    .status(200)
    .cookie("staffAccessToken", accessToken, staffAccessCookieOptions)
    .cookie("staffRefreshToken", refreshToken, staffRefreshCookieOptions)
    .json(new ApiResponse(200, { staff: loggedInStaff }, "Logged in successfully"));
});

// ---- Begin MFA enrollment ----
const setupMfa = asyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.staff._id);

  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(staff.companyEmail, "GreenCards Staff", secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  // stored but mfaEnabled stays false until verifyMfaSetup confirms it
  staff.mfaSecret = secret;
  await staff.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new ApiResponse(200, { qrCodeDataUrl, secret }, "Scan this QR code with your authenticator app"));
});

const verifyMfaSetup = asyncHandler(async (req, res) => {
  const { code } = req.body;

  const staff = await Staff.findById(req.staff._id).select("+mfaSecret");
  if (!staff.mfaSecret) {
    throw new ApiError(400, "Call /staff/mfa/setup first");
  }

  const valid = authenticator.check(code, staff.mfaSecret);
  if (!valid) {
    throw new ApiError(401, "Invalid code — check your authenticator app and try again");
  }

  staff.mfaEnabled = true;
  staff.mfaLastUsedStep = Math.floor(Date.now() / 30000);
  await staff.save({ validateBeforeSave: false });

  await logAudit(staff, "staff.mfa_enabled", { type: "Staff", id: staff._id }, {}, req);

  // Issue upgraded tokens with mfa: true
  const { accessToken, refreshToken } = await generateStaffTokens(staff._id, {
    mfa: true,
  });

  return res
    .status(200)
    .cookie("staffAccessToken", accessToken, staffAccessCookieOptions)
    .cookie("staffRefreshToken", refreshToken, staffRefreshCookieOptions)
    .json(new ApiResponse(200, {}, "MFA enabled successfully"));
});

const disableMfa = asyncHandler(async (req, res) => {
  const { password, code } = req.body;
  const staff = await Staff.findById(req.staff._id).select("+password +mfaSecret");

  if (staff.role === "superadmin" && process.env.REQUIRE_SUPERADMIN_MFA === "true") {
    throw new ApiError(400, "MFA cannot be disabled for superadmin accounts (mandated by security policy)");
  }

  if (!(await staff.isPasswordCorrect(password))) {
    throw new ApiError(401, "Incorrect password");
  }

  const valid = authenticator.check(code, staff.mfaSecret);
  if (!valid) {
    throw new ApiError(401, "Invalid MFA code");
  }

  staff.mfaEnabled = false;
  staff.mfaSecret = undefined;
  staff.mfaLastUsedStep = 0;
  await staff.save({ validateBeforeSave: false });

  await logAudit(staff, "staff.mfa_disabled", { type: "Staff", id: staff._id }, {}, req);

  return res.status(200).json(new ApiResponse(200, {}, "MFA disabled"));
});

const refreshStaffAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken = req.cookies?.staffRefreshToken;
  if (!incomingRefreshToken) {
    throw new ApiError(401, "Unauthorized request");
  }

  let decoded;
  const refreshSecret =
    process.env.SUPERADMIN_REFRESH_TOKEN_SECRET ||
    process.env.STAFF_REFRESH_TOKEN_SECRET ||
    process.env.REFRESH_TOKEN_SECRET;
  try {
    decoded = jwt.verify(incomingRefreshToken, refreshSecret);
  } catch (err) {
    throw new ApiError(401, "Invalid or expired refresh token");
  }
  const staff = await Staff.findById(decoded._id).select("+refreshToken");

  if (!staff || incomingRefreshToken !== staff.refreshToken) {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  if (!staff.isActive) {
    throw new ApiError(403, "Your staff account has been deactivated");
  }

  const { accessToken, refreshToken } = await generateStaffTokens(staff._id, {
    mfa: decoded.mfa === true,
  });

  return res
    .status(200)
    .cookie("staffAccessToken", accessToken, staffAccessCookieOptions)
    .cookie("staffRefreshToken", refreshToken, staffRefreshCookieOptions)
    .json(new ApiResponse(200, {}, "Access token refreshed"));
});

const logoutStaff = asyncHandler(async (req, res) => {
  await Staff.findByIdAndUpdate(req.staff._id, { $unset: { refreshToken: 1 } });

  return res
    .status(200)
    .clearCookie("staffAccessToken", baseStaffCookieOptions)
    .clearCookie("staffRefreshToken", baseStaffCookieOptions)
    .json(new ApiResponse(200, {}, "Logged out successfully"));
});

const getCurrentStaff = asyncHandler(async (req, res) => {
  return res.status(200).json(new ApiResponse(200, req.staff, "Current staff fetched"));
});

const changeStaffPassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  const staff = await Staff.findById(req.staff._id).select("+password");
  if (!(await staff.isPasswordCorrect(oldPassword))) {
    throw new ApiError(401, "Current password is incorrect");
  }

  staff.password = newPassword;
  staff.passwordChangedAt = new Date();
  await staff.save();

  await logAudit(staff, "staff.password_change", { type: "Staff", id: staff._id }, {}, req);

  return res.status(200).json(new ApiResponse(200, {}, "Password changed successfully"));
});

// ---- SuperAdmin-only Staff Management ----

const getAllStaff = asyncHandler(async (req, res) => {
  const staff = await Staff.find().select("-password -refreshToken -mfaSecret").sort({ createdAt: -1 });
  return res.status(200).json(new ApiResponse(200, staff, "Staff fetched"));
});

// Direct Admin Account Creation by SuperAdmin (with duration / time-limit)
const createAdminDirect = asyncHandler(async (req, res) => {
  const { fullName, companyEmail, role = "admin", permissions, durationDays } = req.body;

  // Strict check: Only "admin" role accounts can be created directly.
  // Superadmin creation MUST go through Four-Eyes AccessRequest workflow.
  if (role !== "admin") {
    throw new ApiError(400, "Direct creation is only allowed for Admin accounts. Superadmin accounts require four-eyes access requests.");
  }

  const existing = await Staff.findOne({ companyEmail: companyEmail.toLowerCase() });
  if (existing) {
    throw new ApiError(409, "A staff account with this email already exists");
  }

  // Generate 24-character high-entropy temporary password
  const tempPassword = crypto.randomBytes(18).toString("base64url") + "A1!";

  let roleExpiresAt = null;
  if (durationDays && Number(durationDays) > 0) {
    roleExpiresAt = new Date(Date.now() + Number(durationDays) * 24 * 60 * 60 * 1000);
  }

  const assignedPermissions =
    permissions && permissions.length > 0 ? permissions : DEFAULT_ADMIN_PERMISSIONS;

  const newStaff = await Staff.create({
    fullName,
    companyEmail: companyEmail.toLowerCase(),
    password: tempPassword,
    role: "admin",
    permissions: assignedPermissions,
    roleExpiresAt,
    createdBy: req.staff._id,
    isActive: true,
  });

  await logAudit(
    req.staff,
    "staff.create_direct_admin",
    { type: "Staff", id: newStaff._id },
    {
      role: "admin",
      durationDays: durationDays || null,
      roleExpiresAt,
      permissions: assignedPermissions,
    },
    req
  );

  const staffData = newStaff.toObject();
  delete staffData.password;

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        staff: staffData,
        generatedTempPassword: tempPassword,
      },
      "Admin account created successfully with specified duration"
    )
  );
});

const updateStaffPermissions = asyncHandler(async (req, res) => {
  const { staffId } = req.params;
  const { permissions } = req.body;

  const staff = await Staff.findById(staffId);
  if (!staff) {
    throw new ApiError(404, "Staff member not found");
  }
  if (staff.role === "superadmin") {
    throw new ApiError(400, "Superadmin already has every permission implicitly — nothing to set");
  }

  const previousPermissions = staff.permissions;
  staff.permissions = permissions;
  await staff.save({ validateBeforeSave: false });

  await logAudit(
    req.staff,
    "permission.update",
    { type: "Staff", id: staff._id },
    { previousPermissions, newPermissions: permissions },
    req
  );

  return res.status(200).json(new ApiResponse(200, staff, "Permissions updated"));
});

const toggleStaffActive = asyncHandler(async (req, res) => {
  const { staffId } = req.params;

  const staff = await Staff.findById(staffId);
  if (!staff) {
    throw new ApiError(404, "Staff member not found");
  }
  if (staff._id.equals(req.staff._id)) {
    throw new ApiError(400, "You cannot deactivate your own account");
  }

  staff.isActive = !staff.isActive;
  await staff.save({ validateBeforeSave: false });

  await logAudit(
    req.staff,
    staff.isActive ? "staff.activated" : "staff.deactivated",
    { type: "Staff", id: staff._id },
    {},
    req
  );

  return res.status(200).json(new ApiResponse(200, staff, `Staff ${staff.isActive ? "activated" : "deactivated"}`));
});

// ---- Audit log (read-only, superadmin only) ----
const getAuditLogs = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, action, actorId } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter = {};
  if (action) filter.action = action;
  if (actorId) filter.actorId = actorId;

  const [logs, total] = await Promise.all([
    AuditLog.find(filter)
      .populate("actorId", "fullName companyEmail employeeId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    AuditLog.countDocuments(filter),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      { logs, pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) } },
      "Audit logs fetched"
    )
  );
});

module.exports = {
  loginStaff,
  verifyMfaLogin,
  setupMfa,
  verifyMfaSetup,
  disableMfa,
  refreshStaffAccessToken,
  logoutStaff,
  getCurrentStaff,
  changeStaffPassword,
  getAllStaff,
  createAdminDirect,
  updateStaffPermissions,
  toggleStaffActive,
  getAuditLogs,
};
