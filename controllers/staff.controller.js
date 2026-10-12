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

const DUMMY_HASH = bcrypt.hashSync("greencards-timing-equaliser", 12);

authenticator.options = { window: 1 }; // ±30s clock skew

const generateStaffTokens = async (staffId, { mfa = false } = {}) => {
  const staff = await Staff.findById(staffId);
  const accessToken = staff.generateAccessToken({ mfa });
  const refreshToken = staff.generateRefreshToken({ mfa });

  staff.refreshToken = refreshToken;
  await staff.save({ validateBeforeSave: false });

  return { accessToken, refreshToken };
};

const registerFailure = async (staff, req, reason) => {
  const updated = await Staff.findByIdAndUpdate(
    staff._id,
    { $inc: { failedLoginAttempts: 1 } },
    { new: true }
  );
  await logAudit(
    staff,
    "staff.login_failed",
    { type: "Staff", id: staff._id },
    { reason, attempts: updated?.failedLoginAttempts || 1 },
    req
  );
  if (updated && updated.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
    await Staff.findByIdAndUpdate(staff._id, {
      $set: { lockUntil: new Date(Date.now() + LOCKOUT_DURATION_MS), failedLoginAttempts: 0 },
    });
    await logAudit(
      staff,
      "staff.locked",
      { type: "Staff", id: staff._id },
      { lockMinutes: LOCKOUT_DURATION_MS / 60000, trigger: reason },
      req
    );
  }
};

// Accept a TOTP code at most once (replay protection). Returns true if accepted.
const consumeTotp = async (staff, code) => {
  const delta = authenticator.checkDelta(code, staff.mfaSecret);
  if (delta === null || delta === undefined) return false;
  const step = Math.floor(Date.now() / 1000 / 30) + delta;
  const res = await Staff.updateOne(
    { _id: staff._id, mfaLastUsedStep: { $lt: step } },
    { $set: { mfaLastUsedStep: step } }
  );
  return res.modifiedCount === 1;
};

const issueSession = async (staff, req, res, { mfa }) => {
  const { accessToken, refreshToken } = await generateStaffTokens(staff._id, { mfa });

  staff.lastLoginAt = new Date();
  staff.lastLoginIp = req.ip;
  staff.failedLoginAttempts = 0;
  staff.lockUntil = null;
  await staff.save({ validateBeforeSave: false });

  const loggedInStaff = staff.toObject();
  delete loggedInStaff.password;
  delete loggedInStaff.refreshToken;
  delete loggedInStaff.mfaSecret;
  delete loggedInStaff.mfaLastUsedStep;

  await logAudit(staff, "staff.login", { type: "Staff", id: staff._id }, { mfa }, req);

  const mfaSetupRequired =
    staff.role === "superadmin" && !staff.mfaEnabled && process.env.REQUIRE_SUPERADMIN_MFA === "true";

  return res
    .status(200)
    .cookie("staffAccessToken", accessToken, staffAccessCookieOptions)
    .cookie("staffRefreshToken", refreshToken, staffRefreshCookieOptions)
    .json(
      new ApiResponse(
        200,
        { staff: loggedInStaff, mfaSetupRequired },
        "Logged in successfully"
      )
    );
};

// ---- STEP 1: password login ----
const loginStaff = asyncHandler(async (req, res) => {
  const { companyEmail, password } = req.body;

  const staff = await Staff.findOne({ companyEmail }).select("+password");

  const isLocked = staff && (typeof staff.isLocked === "function" ? staff.isLocked() : staff.isLocked);
  if (isLocked) {
    await bcrypt.compare(password, DUMMY_HASH);
    await logAudit(staff, "staff.login_blocked_locked", { type: "Staff", id: staff._id }, {}, req);
    throw new ApiError(401, "Invalid credentials");
  }

  const passwordOk = staff
    ? await staff.isPasswordCorrect(password)
    : (await bcrypt.compare(password, DUMMY_HASH), false);

  if (!staff || !passwordOk) {
    if (staff) {
      await registerFailure(staff, req, "invalid credentials");
    } else {
      await logAudit(
        { _id: null, companyEmail },
        "staff.login_failed",
        { type: "Staff" },
        { reason: "unknown email" },
        req
      );
    }
    throw new ApiError(401, "Invalid credentials");
  }

  if (!staff.isActive) {
    throw new ApiError(403, "Your staff account has been deactivated");
  }

  if (staff.mfaEnabled) {
    const mfaToken = signMfaChallengeToken(staff._id);
    return res
      .status(200)
      .json(new ApiResponse(200, { mfaRequired: true, mfaToken }, "MFA code required"));
  }

  return issueSession(staff, req, res, { mfa: false });
});

// ---- STEP 2: TOTP verification ----
const verifyMfaLogin = asyncHandler(async (req, res) => {
  const { mfaToken, code } = req.body;

  let challenge;
  try {
    challenge = verifyMfaChallengeToken(mfaToken);
  } catch (err) {
    throw new ApiError(401, "MFA session expired — please sign in again");
  }

  const staff = await Staff.findById(challenge.sub || challenge._id).select("+mfaSecret");
  if (!staff || !staff.mfaEnabled || !staff.isActive) {
    throw new ApiError(401, "Invalid or expired code");
  }
  const isLocked = typeof staff.isLocked === "function" ? staff.isLocked() : staff.isLocked;
  if (isLocked) {
    throw new ApiError(401, "Invalid or expired code");
  }

  if (!(await consumeTotp(staff, code))) {
    await registerFailure(staff, req, "invalid MFA code");
    throw new ApiError(401, "Invalid or expired code");
  }

  return issueSession(staff, req, res, { mfa: true });
});

// ---- Begin MFA enrollment ----
const setupMfa = asyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.staff._id);
  if (staff.mfaEnabled) {
    throw new ApiError(409, "MFA is already enabled — disable it first to re-enrol");
  }

  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(staff.companyEmail, "GreenCards Staff", secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  staff.mfaSecret = secret;
  await staff.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { qrCodeDataUrl, secret },
        "Scan this QR code with your authenticator app"
      )
    );
});

const verifyMfaSetup = asyncHandler(async (req, res) => {
  const { code } = req.body;

  const staff = await Staff.findById(req.staff._id).select("+mfaSecret");
  if (!staff.mfaSecret) {
    throw new ApiError(400, "Call /staff/mfa/setup first");
  }

  if (!(await consumeTotp(staff, code))) {
    throw new ApiError(401, "Invalid code — check your authenticator app and try again");
  }

  staff.mfaEnabled = true;
  await staff.save({ validateBeforeSave: false });

  await logAudit(staff, "staff.mfa_enabled", { type: "Staff", id: staff._id }, {}, req);

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
  if (!staff.mfaEnabled) {
    throw new ApiError(400, "MFA is not enabled");
  }
  if (staff.role === "superadmin" && process.env.REQUIRE_SUPERADMIN_MFA === "true") {
    throw new ApiError(403, "MFA is mandatory for super admin accounts and cannot be disabled");
  }
  if (!(await staff.isPasswordCorrect(password)) || !(await consumeTotp(staff, code))) {
    await registerFailure(staff, req, "invalid re-authentication for MFA disable");
    throw new ApiError(401, "Invalid password or code");
  }

  staff.mfaEnabled = false;
  staff.mfaSecret = undefined;
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
