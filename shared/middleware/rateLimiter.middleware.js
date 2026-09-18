const rateLimit = require("express-rate-limit");

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // raised from 100 — the SPA fires several background auth/category/product
  // calls on every page load across 3 auth contexts, which was exhausting the old
  // budget during normal use/testing and causing false-positive 429s.
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests, please try again later.",
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many attempts, please try again later.",
  skipSuccessfulRequests: true, // successful login/register won't count toward the limit
});

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 3,                    // only 3 resend attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many OTP requests. Please wait a few minutes and try again.",
});

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // 10 order initialization attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many checkout attempts. Please wait a few minutes before trying again.",
});

const sellerApplicationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,                    // 3 application attempts per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many seller application requests. Please try again later.",
});

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,                    // 5 contact form submissions per hour per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many messages sent. Please try again later.",
});

module.exports = {
  apiLimiter,
  authLimiter,
  otpLimiter,
  checkoutLimiter,
  sellerApplicationLimiter,
  contactLimiter,
};
