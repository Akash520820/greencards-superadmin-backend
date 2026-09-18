const { z } = require("zod");
const { objectIdSchema } = require("./order.validators");

const submitContactMessageSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().email("Please provide a valid email").max(200),
  subject: z.string().trim().min(1, "Subject is required").max(150),
  message: z.string().trim().min(10, "Message must be at least 10 characters").max(2000),
});

const contactMessageIdParamSchema = z.object({
  messageId: objectIdSchema,
});

module.exports = { submitContactMessageSchema, contactMessageIdParamSchema };
