const crypto = require("crypto");

const generateOtp = () => {
  const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
  const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");
  return { otp, hashedOtp };
};

module.exports = { generateOtp };