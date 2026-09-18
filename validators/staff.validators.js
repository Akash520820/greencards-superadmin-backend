const { z } = require("zod");
const { objectIdSchema } = require("../validators/order.validators");
const { ALL_PERMISSIONS } = require("../shared/constants/permissions");

const staffLoginSchema = z.object({
  companyEmail: z.string().trim().toLowerCase().email("A valid email is required"),
  password: z.string().min(1, "Password is required"),
});

const staffMfaLoginSchema = z.object({
  staffId: objectIdSchema,
  code: z.string().length(6, "Code must be 6 digits"),
});

const mfaVerifySetupSchema = z.object({
  code: z.string().length(6, "Code must be 6 digits"),
});

const updatePermissionsSchema = z.object({
  permissions: z.array(z.enum(ALL_PERMISSIONS)),
});

const changeStaffPasswordSchema = z.object({
  oldPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

const staffIdParamSchema = z.object({ staffId: objectIdSchema });

module.exports = {
  staffLoginSchema,
  staffMfaLoginSchema,
  mfaVerifySetupSchema,
  updatePermissionsSchema,
  changeStaffPasswordSchema,
  staffIdParamSchema,
};
