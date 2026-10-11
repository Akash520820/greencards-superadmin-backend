require("dotenv").config();
const mongoose = require("mongoose");
const crypto = require("crypto");
const Staff = require("./models/staff.model");
const AuditLog = require("./models/auditLog.model");
const { ALL_PERMISSIONS } = require("./shared/constants/permissions");

async function bootstrap() {
  if (!process.env.MONGODB_URI) {
    console.error("❌ MONGODB_URI is not set in environment.");
    process.exit(1);
  }

  try {
    console.log("⏳ Connecting to MongoDB Atlas (superadmin_db)...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected.");

    // Enforce one-time rule: refuse to run if ANY superadmin already exists
    const superadminCount = await Staff.countDocuments({ role: "superadmin" });
    if (superadminCount > 0) {
      console.error(
        `❌ Refusing to run: ${superadminCount} superadmin account(s) already exist in this database.`
      );
      console.error(
        "To add further staff or superadmins, use the AccessRequest workflow or existing superadmin portal."
      );
      await mongoose.disconnect();
      process.exit(1);
    }

    const email = (
      process.argv[2] ||
      process.env.BOOTSTRAP_SUPERADMIN_EMAIL ||
      "superadmin@greencards.com"
    ).toLowerCase();

    // Check email domain restriction if configured
    if (process.env.STAFF_EMAIL_DOMAIN) {
      const allowedDomain = process.env.STAFF_EMAIL_DOMAIN.toLowerCase();
      if (!email.endsWith(`@${allowedDomain}`)) {
        console.error(
          `❌ Bootstrap email must end with @${allowedDomain} (configured STAFF_EMAIL_DOMAIN)`
        );
        await mongoose.disconnect();
        process.exit(1);
      }
    }

    // Require high-entropy password (min 14 chars, symbols, upper, lower, digit)
    let password = process.argv[3] || process.env.BOOTSTRAP_SUPERADMIN_PASSWORD;
    let generated = false;
    if (!password) {
      // Generate secure 24-character random password
      password = crypto.randomBytes(18).toString("base64url") + "A1!";
      generated = true;
    } else {
      if (
        password.length < 14 ||
        !/[A-Z]/.test(password) ||
        !/[a-z]/.test(password) ||
        !/[0-9]/.test(password) ||
        !/[^A-Za-z0-9]/.test(password)
      ) {
        console.error(
          "❌ Provided password does not meet superadmin complexity requirements (min 14 chars, upper, lower, number, symbol)."
        );
        await mongoose.disconnect();
        process.exit(1);
      }
    }

    const fullName =
      process.argv[4] ||
      process.env.BOOTSTRAP_SUPERADMIN_NAME ||
      "Founding SuperAdmin";

    const newStaff = new Staff({
      fullName,
      companyEmail: email,
      password,
      role: "superadmin",
      permissions: ALL_PERMISSIONS,
      isActive: true,
      mfaEnabled: false,
    });
    await newStaff.save();

    // Append to AuditLog
    await AuditLog.create({
      action: "staff.bootstrap",
      performedBy: "CLI_BOOTSTRAP",
      targetEntity: "staff",
      targetType: "Staff",
      targetId: String(newStaff._id),
      severity: "CRITICAL",
      metadata: {
        email,
        employeeId: newStaff.employeeId,
        generatedPassword: generated,
      },
    });

    console.log("🎉 Successfully bootstrapped the founding SuperAdmin account!");
    console.log("------------------------------------------------------------");
    console.log(`👤 Name:        ${fullName}`);
    console.log(`🆔 Employee ID: ${newStaff.employeeId}`);
    console.log(`📧 Email:       ${email}`);
    console.log(`🔑 Password:    ${password}`);
    console.log("------------------------------------------------------------");
    console.log("⚠️  SAVE THIS PASSWORD NOW. It will not be shown again.");
    console.log("⚠️  Log in immediately and set up Multi-Factor Authentication (MFA).");

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("❌ Error bootstrapping staff account:", err.message);
    process.exit(1);
  }
}

bootstrap();
