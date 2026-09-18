const crypto = require("crypto");
const logger = require("../shared/utils/logger");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const asyncHandler = require("../shared/utils/asyncHandler");
const ApiError = require("../shared/utils/ApiError");
const ApiResponse = require("../shared/utils/ApiResponse");
const User = require("../models/user.model");
const PendingRegistration = require("../models/pendingRegistration.model");
const { uploadOnCloudinary } = require("../shared/utils/cloudinary");
const { generateOtp } = require("../shared/utils/otp");
const sendEmail = require("../shared/utils/sendEmail");

const baseCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "none",
};

// maxAge (ms) MUST be kept in sync with ACCESS_TOKEN_EXPIRY / REFRESH_TOKEN_EXPIRY
// in .env (currently 15m / 1d). Without maxAge, cookie-parser sets these as
// SESSION cookies — the browser deletes them the moment it's fully closed,
// even though the underlying JWT is still valid server-side.
const accessCookieOptions = { ...baseCookieOptions, maxAge: 15 * 60 * 1000 }; // 15 minutes
const refreshCookieOptions = { ...baseCookieOptions, maxAge: 24 * 60 * 60 * 1000 }; // 1 day

const generateAccessTokenAndRefreshToken = async (userId) => {
  const user = await User.findById(userId);
  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();

  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  return { accessToken, refreshToken };
};

// ---- STEP 1: register — sends OTP, does NOT create account yet ----
const registerUser = asyncHandler(async (req, res) => {
  const { userName, email, fullName, password, phone } = req.body;

  if (!userName || !email || !fullName || !password || !phone) {
    throw new ApiError(400, "Please provide all required fields");
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new ApiError(400, "Please provide a valid email address");
  }

  const phoneRegex = /^[6-9]\d{9}$/; // 10-digit Indian mobile number
  if (!phoneRegex.test(phone)) {
    throw new ApiError(400, "Please provide a valid 10-digit phone number");
  }

  const existingUser = await User.findOne({ $or: [{ userName }, { email }] });
  if (existingUser) {
    if (existingUser.userName === userName && existingUser.email === email) {
      throw new ApiError(409, "User already exists with this username and email");
    } else if (existingUser.userName === userName) {
      throw new ApiError(409, "Username is already taken");
    } else {
      throw new ApiError(409, "Email is already registered");
    }
  }

  const avatarLocalPath = req.file?.path;
  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar is required");
  }
  const avatar = await uploadOnCloudinary(avatarLocalPath);
  if (!avatar?.url) {
    throw new ApiError(500, "Something went wrong while uploading avatar");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const { otp, hashedOtp } = generateOtp();
  const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);
  const documentExpiry = new Date(Date.now() + 15 * 60 * 1000);

  // Find all documents in PendingRegistration where the email field matches the one we're currently registering, and delete them.
  await PendingRegistration.deleteMany({ email });

  await PendingRegistration.create({
    userName: userName.toLowerCase(),
    email,
    fullName,
    phone,
    password: hashedPassword,
    avatar: avatar.url,
    otp: hashedOtp,
    otpExpiry,
    expiresAt: documentExpiry,
  });

  try {
    await sendEmail({
      to: email,
      subject: "Your verification code",
      html: `<p>Hi ${fullName},</p><p>Your verification code is:</p><h2 style="letter-spacing: 4px;">${otp}</h2><p>This code expires in 5 minutes.</p>`,
    });
  } catch (error) {
    logger.error("sendEmail failed (register)", { error: error?.stack || error });
    throw new ApiError(500, "Failed to send verification email. Please try registering again.");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, { email }, "Verification code sent to your email. Please verify to complete registration."));
});

// ---- STEP 2: verify OTP — account is ACTUALLY created here ----
const verifyRegistrationOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    throw new ApiError(400, "Email and OTP are required");
  }

  const pending = await PendingRegistration.findOne({ email });
  if (!pending) {
    throw new ApiError(400, "No pending registration found for this email. Please register again.");
  }

  if (pending.otpExpiry < new Date()) {
    throw new ApiError(400, "OTP has expired. Please request a new OTP.");
  }

  const hashedIncomingOtp = crypto.createHash("sha256").update(otp).digest("hex");
  if (hashedIncomingOtp !== pending.otp) {
    throw new ApiError(400, "Invalid OTP");
  }

  const existingUser = await User.findOne({ $or: [{ userName: pending.userName }, { email: pending.email }] });
  if (existingUser) {
    await PendingRegistration.deleteOne({ _id: pending._id });
    throw new ApiError(409, "This username or email was registered by someone else in the meantime. Please register again.");
  }

  const user = new User({
    userName: pending.userName,
    email: pending.email,
    fullName: pending.fullName,
    phone: pending.phone,
    password: pending.password,
    avatar: pending.avatar,
    isEmailVerified: true,
  });
  user.$locals.skipPasswordHash = true;
  await user.save({ validateBeforeSave: false });

  await PendingRegistration.deleteOne({ _id: pending._id });

  const { accessToken, refreshToken } = await generateAccessTokenAndRefreshToken(user._id);

  const createdUser = user.toObject();
  delete createdUser.password;
  delete createdUser.refreshToken;

  return res
    .status(201)
    .cookie("accessToken", accessToken, accessCookieOptions)
    .cookie("refreshToken", refreshToken, refreshCookieOptions)
    .json(new ApiResponse(201, { user: createdUser }, "Email verified and account created successfully"));
});

// ---- RESEND OTP — reuses existing pending registration data, no need to re-fill the whole form ----
const resendRegistrationOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    throw new ApiError(400, "Email is required");
  }

  const pending = await PendingRegistration.findOne({ email });
  if (!pending) {
    throw new ApiError(400, "No pending registration found for this email. Please register again.");
  }

  const { otp, hashedOtp } = generateOtp();
  const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);
  const documentExpiry = new Date(Date.now() + 15 * 60 * 1000);

  pending.otp = hashedOtp;
  pending.otpExpiry = otpExpiry;
  pending.expiresAt = documentExpiry;
  await pending.save();

  try {
    await sendEmail({
      to: pending.email,
      subject: "Your new verification code",
      html: `<p>Hi ${pending.fullName},</p><p>Your new verification code is:</p><h2 style="letter-spacing: 4px;">${otp}</h2><p>This code expires in 5 minutes.</p>`,
    });
  } catch (error) {
    logger.error("sendEmail failed (resend-otp)", { error: error?.stack || error });
    throw new ApiError(500, "Failed to send verification email. Please try again.");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, { email }, "A new verification code has been sent to your email."));
});

// ---- LOGIN ----
const loginUser = asyncHandler(async (req, res) => {
  const { email, userName, password } = req.body;

  if (!email && !userName) {
    throw new ApiError(400, "Email or username is required");
  }
  if (!password) {
    throw new ApiError(400, "Password is required");
  }

  const user = await User.findOne({ $or: [{ email }, { userName }] }).select("+password");

  if (!user || !(await user.isPasswordCorrect(password))) {
    throw new ApiError(401, "Invalid credentials");
  }

  const { accessToken, refreshToken } = await generateAccessTokenAndRefreshToken(user._id);

  const loggedInUser = user.toObject();
  delete loggedInUser.password;
  delete loggedInUser.refreshToken;

  return res
    .status(200)
    .cookie("accessToken", accessToken, accessCookieOptions)
    .cookie("refreshToken", refreshToken, refreshCookieOptions)
    .json(new ApiResponse(200, { user: loggedInUser }, "Logged in successfully"));
});

// ---- LOGOUT ----
const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { $unset: { refreshToken: 1 } });

  return res
    .status(200)
    .clearCookie("accessToken", baseCookieOptions)
    .clearCookie("refreshToken", baseCookieOptions)
    .json(new ApiResponse(200, {}, "Logged out successfully"));
});

// ---- REFRESH ACCESS TOKEN ----
const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

  if (!incomingRefreshToken) {
    throw new ApiError(401, "Unauthorized request");
  }

  let decoded;
  try {
    decoded = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);
  } catch (err) {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  const user = await User.findById(decoded._id);
  if (!user || incomingRefreshToken !== user.refreshToken) {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  const { accessToken, refreshToken } = await generateAccessTokenAndRefreshToken(user._id);

  return res
    .status(200)
    .cookie("accessToken", accessToken, accessCookieOptions)
    .cookie("refreshToken", refreshToken, refreshCookieOptions)
    .json(new ApiResponse(200, "Access token refreshed"));
});

// ---- CURRENT USER ----
const getCurrentUser = asyncHandler(async (req, res) => {
  return res.status(200).json(new ApiResponse(200, req.user, "Current user fetched"));
});

// ---- STEP 1: request password reset — sends OTP to registered email ----
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    throw new ApiError(400, "Email is required");
  }

  const user = await User.findOne({ email });
  if (!user) {
    // generic message — don't reveal whether this email exists in our system
    return res
      .status(200)
      .json(new ApiResponse(200, {}, "If an account exists with this email, a reset code has been sent."));
  }

  const { otp, hashedOtp } = generateOtp();
  const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

  user.resetPasswordOtp = hashedOtp;
  user.resetPasswordOtpExpiry = otpExpiry;
  await user.save({ validateBeforeSave: false });

  try {
    await sendEmail({
      to: email,
      subject: "Password reset code",
      html: `<p>Hi ${user.fullName},</p><p>Your password reset code is:</p><h2 style="letter-spacing: 4px;">${otp}</h2><p>This code expires in 5 minutes. If you didn't request this, please ignore this email.</p>`,
    });
  } catch (error) {
       logger.error("sendEmail failed (forgot-password)", { error: error?.stack || error });
       user.resetPasswordOtp = undefined;
       user.resetPasswordOtpExpiry = undefined;
       await user.save({ validateBeforeSave: false });
       throw new ApiError(500, "Failed to send reset email. Please try again.");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "If an account exists with this email, a reset code has been sent."));
});

// ---- STEP 2: verify OTP + set new password ----
const resetPassword = asyncHandler(async (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    throw new ApiError(400, "Email, OTP, and new password are required");
  }

  const user = await User.findOne({ email });
  if (!user || !user.resetPasswordOtp || !user.resetPasswordOtpExpiry) {
    throw new ApiError(400, "Invalid or expired reset request. Please try again.");
  }

  if (user.resetPasswordOtpExpiry < new Date()) {
    throw new ApiError(400, "Reset code has expired. Please request a new one.");
  }

  const hashedIncomingOtp = crypto.createHash("sha256").update(otp).digest("hex");
  if (hashedIncomingOtp !== user.resetPasswordOtp) {
    throw new ApiError(400, "Invalid reset code");
  }

  // set new password — pre-save hook will hash it automatically since isModified("password") is true
  user.password = newPassword;
  user.resetPasswordOtp = undefined;
  user.resetPasswordOtpExpiry = undefined;

  // invalidate any existing session — force re-login everywhere after password reset
  user.refreshToken = undefined;

  // validateBeforeSave: false — this save only touches password/OTP/session fields,
  // it should not fail just because an older account is missing an unrelated required field
  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password reset successfully. Please log in with your new password."));
});

module.exports = {
  registerUser,
  verifyRegistrationOtp,
  resendRegistrationOtp,
  loginUser,
  logoutUser,
  refreshAccessToken,
  getCurrentUser,
  forgotPassword,
  resetPassword,
};