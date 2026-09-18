const mongoose = require("mongoose");

const pendingRegistrationSchema = new mongoose.Schema({
  userName: { type: String, required: true, lowercase: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  fullName: { type: String, required: true },
  phone: { type: String, required: true },
  password: { type: String, required: true }, // already hashed before saving here
  avatar: { type: String, required: true },
  otp: { type: String, required: true }, // hashed otp
  otpExpiry: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
});

// TTL index — MongoDB auto-deletes the document once expiresAt passes
pendingRegistrationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("PendingRegistration", pendingRegistrationSchema);