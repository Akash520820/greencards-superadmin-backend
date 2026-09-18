const mongoose = require("mongoose");

// Stores every submission from the public Contact page. Persisting it here
// (rather than only emailing it) means a message is never lost even if the
// outbound email fails to send, and gives admins an in-app inbox to work
// from without needing mail access.
const contactMessageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    subject: { type: String, required: true, trim: true, maxlength: 150 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    status: {
      type: String,
      enum: ["new", "read"],
      default: "new",
    },
    emailSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

contactMessageSchema.index({ createdAt: -1 });

module.exports = mongoose.model("ContactMessage", contactMessageSchema);
