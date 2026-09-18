const asyncHandler = require("../shared/utils/asyncHandler");
const ApiError = require("../shared/utils/ApiError");
const ApiResponse = require("../shared/utils/ApiResponse");
const ContactMessage = require("../models/contactMessage.model");
const sendEmail = require("../shared/utils/sendEmail");
const logger = require("../shared/utils/logger");

// ---- PUBLIC: submit the Contact Us form ----
// The message is always persisted first, so it is never lost even if the
// notification email fails to send — email delivery is best-effort only
// and never fails the request back to the visitor.
const submitContactMessage = asyncHandler(async (req, res) => {
  const { name, email, subject, message } = req.body;

  const contactMessage = await ContactMessage.create({ name, email, subject, message });

  const notifyTo = process.env.CONTACT_RECEIVER_EMAIL;
  if (notifyTo) {
    try {
      await sendEmail({
        to: notifyTo,
        subject: `New contact message: ${subject}`,
        html: `
          <p><strong>From:</strong> ${name} (${email})</p>
          <p><strong>Subject:</strong> ${subject}</p>
          <p><strong>Message:</strong></p>
          <p>${message.replace(/\n/g, "<br/>")}</p>
        `,
      });
      contactMessage.emailSent = true;
      await contactMessage.save();
    } catch (error) {
      // Don't fail the request — the message is safely saved either way,
      // and an admin can still see it under Admin > Contact Messages.
      logger.error("sendEmail failed (contact message notification)", { error: error?.stack || error });
    }
  }

  return res
    .status(201)
    .json(new ApiResponse(201, contactMessage, "Thanks for reaching out — we'll get back to you soon."));
});

// ---- ADMIN: list contact messages, newest first ----
const getContactMessages = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;

  const filter = {};
  if (status) filter.status = status;

  const skip = (Number(page) - 1) * Number(limit);

  const [messages, total, newCount] = await Promise.all([
    ContactMessage.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    ContactMessage.countDocuments(filter),
    ContactMessage.countDocuments({ status: "new" }),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      { messages, newCount, pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) } },
      "Contact messages fetched successfully"
    )
  );
});

// ---- ADMIN: mark a message as read ----
const markContactMessageRead = asyncHandler(async (req, res) => {
  const { messageId } = req.params;

  const message = await ContactMessage.findByIdAndUpdate(
    messageId,
    { status: "read" },
    { new: true }
  );

  if (!message) {
    throw new ApiError(404, "Message not found");
  }

  return res.status(200).json(new ApiResponse(200, message, "Message marked as read"));
});

module.exports = { submitContactMessage, getContactMessages, markContactMessageRead };
