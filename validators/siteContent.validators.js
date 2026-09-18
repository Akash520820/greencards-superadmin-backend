const { z } = require("zod");

const faqItemSchema = z.object({
  question: z.string().trim().min(1, "Question is required").max(300),
  answer: z.string().trim().min(1, "Answer is required").max(2000),
});

const paymentMethodItemSchema = z.object({
  name: z.string().trim().min(1, "Payment method name is required").max(100),
  description: z.string().trim().min(1, "Description is required").max(500),
});

const socialLinksSchema = z.object({
  instagram: z.string().trim().max(300).optional().or(z.literal("")),
  twitter: z.string().trim().max(300).optional().or(z.literal("")),
  facebook: z.string().trim().max(300).optional().or(z.literal("")),
  youtube: z.string().trim().max(300).optional().or(z.literal("")),
});

const contactInfoSchema = z.object({
  email: z.string().trim().max(200).optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional().or(z.literal("")),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  supportHours: z.string().trim().max(100).optional().or(z.literal("")),
  socialLinks: socialLinksSchema.optional(),
});

// All fields optional — admin can update just one section (e.g. only FAQs)
// without having to resend everything else.
const updateSiteContentSchema = z.object({
  faqs: z.array(faqItemSchema).optional(),
  deliveryInformation: z.string().trim().min(1).max(5000).optional(),
  returnRefundPolicy: z.string().trim().min(1).max(5000).optional(),
  paymentMethods: z.array(paymentMethodItemSchema).optional(),
  contactInfo: contactInfoSchema.optional(),
});

module.exports = { updateSiteContentSchema };