const { v2: cloudinary } = require("cloudinary");
const fs = require("fs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const uploadOnCloudinary = async (localFilePath) => {
  try {
    if (!localFilePath) return null;

    const response = await cloudinary.uploader.upload(localFilePath, {
      resource_type: "auto",
      secure: true,
    });

    fs.unlinkSync(localFilePath);

    // Cloudinary always returns both `url` (http) and `secure_url` (https).
    // Every controller in this codebase reads `.url`, so normalize it here
    // to the https version to avoid mixed-content warnings/blocks on the
    // frontend (which is served over HTTPS via GitHub Pages).
    if (response?.secure_url) {
      response.url = response.secure_url;
    }

    return response;
  } catch (error) {
    fs.unlinkSync(localFilePath);
    return null;
  }
};

module.exports = { uploadOnCloudinary };