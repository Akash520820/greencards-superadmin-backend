const asyncHandler = require("../shared/utils/asyncHandler");
const ApiResponse = require("../shared/utils/ApiResponse");
const SiteContent = require("../models/siteContent.model");

// ---- GET site content (public) — powers FAQs, Delivery Information,
// Return & Refund Policy, and Payment Methods pages on the frontend ----
const getSiteContent = asyncHandler(async (req, res) => {
  const content = await SiteContent.getSingleton();

  return res
    .status(200)
    .json(new ApiResponse(200, content, "Site content fetched successfully"));
});

// ---- UPDATE site content (admin only) — any subset of fields may be sent ----
const updateSiteContent = asyncHandler(async (req, res) => {
  const content = await SiteContent.getSingleton();

  const { faqs, deliveryInformation, returnRefundPolicy, paymentMethods, contactInfo } = req.body;

  if (faqs !== undefined) content.faqs = faqs;
  if (deliveryInformation !== undefined) content.deliveryInformation = deliveryInformation;
  if (returnRefundPolicy !== undefined) content.returnRefundPolicy = returnRefundPolicy;
  if (paymentMethods !== undefined) content.paymentMethods = paymentMethods;
  if (contactInfo !== undefined) {
    // Merge rather than replace, so the admin form can send just the field(s)
    // it changed (e.g. only the phone number) without wiping the rest.
    content.contactInfo = {
      ...(content.contactInfo?.toObject?.() || content.contactInfo || {}),
      ...contactInfo,
      socialLinks: {
        ...(content.contactInfo?.socialLinks?.toObject?.() || content.contactInfo?.socialLinks || {}),
        ...(contactInfo.socialLinks || {}),
      },
    };
  }

  await content.save();

  return res
    .status(200)
    .json(new ApiResponse(200, content, "Site content updated successfully"));
});

module.exports = { getSiteContent, updateSiteContent };