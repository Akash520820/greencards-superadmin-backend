const { z } = require("zod");
const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");
const { ALL_PERMISSIONS } = require("../shared/constants/permissions");

const strongPassword = z
  .string()
  .min(14, "Password must be at least 14 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one symbol");

const staffLoginSchema = z.object({
  companyEmail: z.string().trim().toLowerCase().email("A valid email is required"),
  password: z.string().min(1, "Password is required"),
});

const staffMfaLoginSchema = z.object({
  staffId: objectIdSchema.optional(),
  mfaToken: z.string().min(10, "MFA challenge token is required").optional(),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
}).refine((data) => data.mfaToken || data.staffId, {
  message: "Either mfaToken or staffId is required",
});

const mfaVerifySetupSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

const disableMfaSchema = z.object({
  password: z.string().min(1, "Password is required"),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

const updatePermissionsSchema = z.object({
  permissions: z.array(z.enum(ALL_PERMISSIONS)),
});

const changeStaffPasswordSchema = z.object({
  oldPassword: z.string().min(1, "Current password is required"),
  newPassword: strongPassword,
});

const createAdminSchema = z.object({
  fullName: z.string().min(1, "Full name is required").trim(),
  companyEmail: z.string().trim().toLowerCase().email("A valid email is required"),
  role: z.enum(["admin"]).default("admin"),
  permissions: z.array(z.enum(ALL_PERMISSIONS)).optional().default([]),
  durationDays: z.number().int().positive("Duration must be a positive integer").optional().nullable(),
});

const staffIdParamSchema = z.object({ staffId: objectIdSchema });

module.exports = {
  strongPassword,
  staffLoginSchema,
  staffMfaLoginSchema,
  mfaVerifySetupSchema,
  disableMfaSchema,
  updatePermissionsSchema,
  changeStaffPasswordSchema,
  createAdminSchema,
  staffIdParamSchema,
};
