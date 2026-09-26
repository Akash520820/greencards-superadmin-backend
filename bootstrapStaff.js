require('dotenv').config();
const mongoose = require('mongoose');
const Staff = require('./models/staff.model');
const { ALL_PERMISSIONS } = require('./shared/constants/permissions');

async function bootstrap() {
  const email = process.argv[2] || process.env.BOOTSTRAP_SUPERADMIN_EMAIL || 'superadmin@greencards.com';
  const password = process.argv[3] || process.env.BOOTSTRAP_SUPERADMIN_PASSWORD || 'SuperAdmin@123';
  const fullName = process.argv[4] || 'Master SuperAdmin';
  const role = process.argv[5] || 'superadmin';

  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI is not set in .env');
    process.exit(1);
  }

  try {
    console.log('⏳ Connecting to MongoDB Atlas (superadmin_db)...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected.');

    const existing = await Staff.findOne({ companyEmail: email.toLowerCase() });
    if (existing) {
      console.log(`⚠️ Staff account with email ${email} already exists (Role: ${existing.role}).`);
      console.log('Updating password and ensuring role & permissions...');
      existing.password = password;
      existing.role = role;
      existing.permissions = ALL_PERMISSIONS;
      existing.isActive = true;
      existing.mfaEnabled = false;
      await existing.save();
      console.log(`🎉 Successfully updated ${role} account!`);
    } else {
      const newStaff = new Staff({
        fullName,
        companyEmail: email.toLowerCase(),
        password,
        role,
        permissions: ALL_PERMISSIONS,
        isActive: true,
        mfaEnabled: false,
      });
      await newStaff.save();
      console.log(`🎉 Successfully created new ${role} account!`);
    }

    console.log('----------------------------------------------------');
    console.log(`👤 Role:     ${role}`);
    console.log(`📧 Email:    ${email}`);
    console.log(`🔑 Password: ${password}`);
    console.log('----------------------------------------------------');
    console.log('You can now log in at:');
    if (role === 'superadmin') {
      console.log('👉 https://akash520820.github.io/greencards-superadmin-portal/admin/auth');
    } else {
      console.log('👉 https://akash520820.github.io/greencards-admin-portal/admin/auth');
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error creating staff account:', err.message);
    process.exit(1);
  }
}

bootstrap();
