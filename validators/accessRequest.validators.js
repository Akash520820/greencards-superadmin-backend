const { z } = require("zod");
const { objectIdSchema } = require("../validators/order.validators");
const { ALL_PERMISSIONS } = require("../shared/constants/permissions");

const createStaffRequestSchema = z.object({
  type: z.literal("create_staff"),
  targetEmail: z.string().trim().toLowerCase().email("A valid email is required"),
  targetFullName: z.string().trim().min(1, "Full name is required"),
  requestedRole: z.enum(["admin", "superadmin"]),
  requestedPermissions: z.array(z.enum(ALL_PERMISSIONS)).default([]),
  reason: z.string().trim().min(1, "A reason is required").max(1000),
});

const extendElevationRequestSchema = z.object({
  type: z.literal("extend_elevation"),
  targetStaffId: objectIdSchema,
  requestedRole: z.enum(["admin", "superadmin"]),
  durationHours: z.number().int().min(1).max(720),
  reason: z.string().trim().min(1, "A reason is required").max(1000),
});

const createAccessRequestSchema = z.discriminatedUnion("type", [
  createStaffRequestSchema,
  extendElevationRequestSchema,
]);

const reviewAccessRequestSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().trim().max(1000).optional(),
});

const accessRequestIdParamSchema = z.object({ requestId: objectIdSchema });

module.exports = {
  createAccessRequestSchema,
  reviewAccessRequestSchema,
  accessRequestIdParamSchema,
};
