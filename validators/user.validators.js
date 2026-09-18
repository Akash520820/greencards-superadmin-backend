const { z } = require("zod");

// Mirrors the checks previously hand-rolled in user.controller.js — same
// rules, now declared once and enforced consistently (and impossible to
// accidentally skip when someone adds a new field later).

const emailSchema = z.string().trim().email("Please provide a valid email address");
const phoneSchema = z.string().regex(/^[6-9]\d{9}$/, "Please provide a valid 10-digit phone number");
const passwordSchema = z.string().min(8, "Password must be at least 8 characters long");
const otpSchema = z.string().regex(/^\d{6}$/, "OTP must be a 6-digit code");

const registerUserSchema = z.object({
  userName: z.string().trim().min(3, "Username must be at least 3 characters").max(30),
  email: emailSchema,
  fullName: z.string().trim().min(1, "Full name is required").max(100),
  password: passwordSchema,
  phone: phoneSchema,
});

const verifyRegistrationOtpSchema = z.object({
  email: emailSchema,
  otp: otpSchema,
});

const resendRegistrationOtpSchema = z.object({
  email: emailSchema,
});

const loginUserSchema = z
  .object({
    email: emailSchema.optional(),
    userName: z.string().trim().min(1).optional(),
    password: z.string({ error: "Password is required" }).min(1, "Password is required"),
  })
  .refine((data) => data.email || data.userName, {
    message: "Email or username is required",
    path: ["email"],
  });

const forgotPasswordSchema = z.object({
  email: emailSchema,
});

const resetPasswordSchema = z.object({
  email: emailSchema,
  otp: otpSchema,
  newPassword: passwordSchema,
});

module.exports = {
  registerUserSchema,
  verifyRegistrationOtpSchema,
  resendRegistrationOtpSchema,
  loginUserSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
};
