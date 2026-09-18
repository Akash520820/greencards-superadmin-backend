const multer = require("multer");
const fs = require("fs");
const path = require("path");

const tempDir = path.join(process.cwd(), "public", "temp");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Git doesn't track empty folders, so public/temp may not exist at all
    // on a fresh deploy (this is exactly what caused ENOENT on Render).
    // Ensure it exists right before every upload instead of relying on it
    // already being there.
    fs.mkdirSync(tempDir, { recursive: true });
    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  },
});

const upload = multer({ storage });

module.exports = upload;