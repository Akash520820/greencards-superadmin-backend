const { z } = require("zod");
const { objectIdSchema } = require("./order.validators");

const addAddressSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required"),
  phone: z.string().regex(/^[6-9]\d{9}$/, "Please provide a valid 10-digit phone number"),
  addressLine1: z.string().trim().min(1, "Address line 1 is required"),
  addressLine2: z.string().trim().optional(),
  city: z.string().trim().min(1, "City is required"),
  state: z.string().trim().min(1, "State is required"),
  pincode: z.string().regex(/^\d{6}$/, "Pincode must be 6 digits"),
  country: z.string().trim().optional(),
  isDefault: z.coerce.boolean().optional(),
});

// updateAddress is a genuine partial update in the controller (each field is
// only applied `if (field)`/`if (field !== undefined)`), so every field is
// optional here too — but any field that IS sent still has to be valid.
const updateAddressSchema = addAddressSchema.partial();

const addressIdParamSchema = z.object({
  addressId: objectIdSchema,
});

module.exports = { addAddressSchema, updateAddressSchema, addressIdParamSchema };
