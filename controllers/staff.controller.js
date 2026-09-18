const jwt = require("jsonwebtoken");
const { authenticator } = require("otplib");
const QRCode = require("qrcode");
const asyncHandler = require("../shared/utils/asyncHandler");
const ApiError = require("../shared/utils/ApiError");
const ApiResponse = require("../shared/utils/ApiResponse");
const Staff = require("../models/staff.model");
const AuditLog = require("../models/auditLog.model");
const { logAudit } = require("../shared/utils/auditLog.util");

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

const generateStaffTokens = async (staffId) => {
  const staff = await Staff.findById(staffId);
  const accessToken = staff.generateAccessToken();
  const refreshToken = staff.generateRefreshToken();

  staff.refreshToken = refreshToken;
  await staff.save({ validateBeforeSave: false });

  return { accessToken, refreshToken };
};

// ---- STEP 1: password login. If MFA is enabled, does NOT issue tokens —
// returns { mfaRequired: true, staffId } and the client calls /staff/mfa/login next ----
const loginStaff = asyncHandler(async (req, res) => {
  const { companyEmail, password } = req.body;

  const staff = await Staff.findOne({ companyEmail }).select("+password");

  if (!staff || !(await staff.isPasswordCorrect(password))) {
    // no actor identity to attribute this to yet — log with the attempted email instead
    await logAudit(
      { _id: null, companyEmail },
      "staff.login_failed",
      { type: "Staff" },
      { reason: "invalid credentials" },
      req
    );
    throw new ApiError(401, "Invalid credentials");
  }

  if (!staff.isActive) {
    throw new ApiError(403, "Your staff account has been deactivated");
  }

  if (staff.mfaEnabled) {
    return res
      .status(200)
      .json(new ApiResponse(200, { mfaRequired: true, staffId: staff._id }, "MFA code required"));
  }

  const { accessToken, refreshToken } = await generateStaffTokens(staff._id);

  staff.lastLoginAt = new Date();
  staff.lastLoginIp = req.ip;
  await staff.save({ validateBeforeSave: false });

  const loggedInStaff = staff.toObject();
  delete loggedInStaff.password;
  delete loggedInStaff.refreshToken;

  await logAudit(staff, "staff.login", { type: "Staff", id: staff._id }, {}, req);

  return res
    .status(200)
    .cookie("staffAccessToken", accessToken, staffAccessCookieOptions)
    .cookie("staffRefreshToken", refreshToken, staffRefreshCookieOptions)
    .json(new ApiResponse(200, { staff: loggedInStaff }, "Logged in successfully"));
});

// ---- STEP 2: TOTP verification, only reached when loginStaff responded mfaRequired ----
const verifyMfaLogin = asyncHandler(async (req, res) => {
  const { staffId, code } = req.body;

  const staff = await Staff.findById(staffId).select("+mfaSecret");
  if (!staff || !staff.mfaEnabled) {
    throw new ApiError(400, "MFA is not enabled for this account");
  }

  const valid = authenticator.check(code, staff.mfaSecret);
  if (!valid) {
    await logAudit(staff, "staff.login_failed", { type: "Staff", id: staff._id }, { reason: "invalid MFA code" }, req);
    throw new ApiError(401, "Invalid or expired code");
  }

  const { accessToken, refreshToken } = await generateStaffTokens(staff._id);

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

// ---- Begin MFA enrollment: generates a secret + QR code, NOT yet enabled
// until verifyMfaSetup confirms the staff member can actually generate codes ----
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
  await staff.save({ validateBeforeSave: false });

  await logAudit(staff, "staff.mfa_enabled", { type: "Staff", id: staff._id }, {}, req);

  return res.status(200).json(new ApiResponse(200, {}, "MFA enabled"));
});

const disableMfa = asyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.staff._id);
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
  try {
    decoded = jwt.verify(incomingRefreshToken, process.env.STAFF_REFRESH_TOKEN_SECRET);
  } catch (err) {
    throw new ApiError(401, "Invalid or expired refresh token");
  }
  const staff = await Staff.findById(decoded._id).select("+refreshToken");

  if (!staff || incomingRefreshToken !== staff.refreshToken) {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  const { accessToken, refreshToken } = await generateStaffTokens(staff._id);

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
  await staff.save();

  await logAudit(staff, "staff.password_change", { type: "Staff", id: staff._id }, {}, req);

  return res.status(200).json(new ApiResponse(200, {}, "Password changed successfully"));
});

// ---- Superadmin-only staff management ----

const getAllStaff = asyncHandler(async (req, res) => {
  const staff = await Staff.find().select("-password -refreshToken -mfaSecret").sort({ createdAt: -1 });
  return res.status(200).json(new ApiResponse(200, staff, "Staff fetched"));
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
    { previousPermissions, newPermissions: permissions }
  , req);

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
  updateStaffPermissions,
  toggleStaffActive,
  getAuditLogs,
};
