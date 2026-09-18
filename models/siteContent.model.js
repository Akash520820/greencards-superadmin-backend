const mongoose = require("mongoose");

const faqItemSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const paymentMethodItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // e.g. "UPI", "Credit/Debit Card", "Cash on Delivery"
    description: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const socialLinksSchema = new mongoose.Schema(
  {
    instagram: { type: String, trim: true, default: "" },
    twitter: { type: String, trim: true, default: "" },
    facebook: { type: String, trim: true, default: "" },
    youtube: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

// Backs the "Get in touch" info panel on the Contact page — editable by
// Admin/SuperAdmin only (same PATCH /site-content route + verifyAdmin
// guard as the rest of this document). Left blank by default on purpose —
// the Contact page shows an empty state until an admin fills this in,
// the same way the FAQs page does.
const contactInfoSchema = new mongoose.Schema(
  {
    email: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    supportHours: { type: String, trim: true, default: "" },
    socialLinks: { type: socialLinksSchema, default: () => ({}) },
  },
  { _id: false }
);

// This is a singleton collection — there is exactly one document, fetched
// with SiteContent.getSingleton() below. It backs the footer's static
// info pages (FAQs, Delivery Information, Return & Refund Policy,
// Payment Methods) so an admin can edit the copy without a redeploy.
const siteContentSchema = new mongoose.Schema(
  {
    faqs: {
      type: [faqItemSchema],
      default: [],
    },
    deliveryInformation: {
      type: String,
      default:
        "We currently deliver within 30–45 minutes for most in-city addresses. " +
        "Delivery charges and estimated times are shown at checkout based on your address.",
    },
    returnRefundPolicy: {
      type: String,
      default:
        "If you're not satisfied with your order, you can request a return within 7 days of delivery. " +
        "Once your return is approved and received, refunds are processed to your original payment method within 5–7 business days.",
    },
    paymentMethods: {
      type: [paymentMethodItemSchema],
      default: [
        { name: "UPI", description: "Pay instantly using any UPI app." },
        { name: "Credit / Debit Card", description: "All major cards accepted, processed securely via Razorpay." },
        { name: "Cash on Delivery", description: "Pay in cash when your order arrives." },
      ],
    },
    contactInfo: {
      type: contactInfoSchema,
      default: () => ({}),
    },
  },
  { timestamps: true }
);

// There should only ever be one SiteContent document. This helper fetches
// it, creating the default one on first access if it doesn't exist yet.
siteContentSchema.statics.getSingleton = async function () {
  let doc = await this.findOne();
  if (!doc) {
    doc = await this.create({});
  }
  return doc;
};

module.exports = mongoose.model("SiteContent", siteContentSchema);