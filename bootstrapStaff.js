/**
 * One-time bootstrap of the FIRST super admin.
 *
 *   node bootstrapStaff.js --email ceo@yourcompany.com --name "Full Name"
 *
 * Security properties (the old script had none of these):
 *  - No default email/password. A hard-coded "SuperAdmin@123" is the first
 *    thing every attacker tries.
 *  - The password is generated here (24 random chars), printed ONCE to this
 *    terminal, and never read from argv/env (argv leaks into shell history and
 *    process listings).
 *  - Refuses to run if ANY superadmin already exists. It can no longer be used
 *    to silently reset a live super admin's password or switch their MFA off.
 *    Further super admins must go through the two-person access-request flow.
 *  - The account is flagged so MFA must be enrolled before it can do anything
 *    privileged (REQUIRE_SUPERADMIN_MFA=true in production).
 *  - Appends an audit record.
 *
 * Run it from a trusted machine, against production, once. Then rotate or
 * remove MONGODB_URI from that machine.
 */
require("dotenv").config();
const crypto = require("crypto");
const mongoose = require("mongoose");
const Staff = require("./models/staff.model");
const AuditLog = require("./models/auditLog.model");
const { ALL_PERMISSIONS } = require("./shared/constants/permissions");

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

(async () => {
  const email = (arg("email") || "").toLowerCase().trim();
  const fullName = (arg("name") || "").trim();

  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is not set");
    process.exit(1);
  }
  if (!email || !fullName) {
    console.error('Usage: node bootstrapStaff.js --email <company email> --name "<full name>"');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);

    if (await Staff.exists({ role: "superadmin" })) {
      console.error("A super admin already exists. Bootstrap is single-use.");
      console.error("Create additional super admins via the 2-person access-request workflow.");
      process.exit(2);
    }

    const password = crypto.randomBytes(18).toString("base64url"); // 24 chars, ~144 bits
    const staff = await Staff.create({
      fullName,
      companyEmail: email,
      password,
      role: "superadmin",
      permissions: ALL_PERMISSIONS,
      isActive: true,
      mfaEnabled: false,
    });

    await AuditLog.create({
      action: "staff.bootstrap_superadmin",
      actorEmail: "bootstrap-script",
      targetType: "Staff",
      targetId: String(staff._id),
      severity: "CRITICAL",
      metadata: { email },
    });

    console.log("\nSuper admin created.");
    console.log(`  Email:    ${email}`);
    console.log(`  Password: ${password}   <- shown ONCE; store it in your password manager now`);
    console.log("\nNext steps:");
    console.log("  1. Sign in and IMMEDIATELY enrol an authenticator app (MFA).");
    console.log("  2. Change the password (14+ characters).");
    console.log("  3. Register a second hardware-backed authenticator / save recovery material offline.");
    console.log("  4. Set REQUIRE_SUPERADMIN_MFA=true, IP_ALLOWLIST_ENABLED=true on the service.\n");
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("Bootstrap error:", err.message);
    process.exit(1);
  }
})();
