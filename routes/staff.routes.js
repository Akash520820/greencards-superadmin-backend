const { Router } = require("express");
const {
  loginStaff,
  verifyMfaLogin,
  setupMfa,
  verifyMfaSetup,
  disableMfa,
  refreshStaffAccessToken,
  logoutStaff,
  getCurrentStaff,
  changeStaffPassword,
  getAllStaff,
  updateStaffPermissions,
  toggleStaffActive,
  getAuditLogs,
} = require("../controllers/staff.controller");
const {
  createAccessRequest,
  getAccessRequests,
  reviewAccessRequest,
} = require("../controllers/accessRequest.controller");
const { verifyStaffJWT, verifySuperAdmin, verifyPermission } = require("../shared/middleware/auth.middleware");
const { ipAllowlist } = require("../shared/middleware/ipAllowlist.middleware");
const validate = require("../shared/middleware/validate.middleware");
const { authLimiter } = require("../shared/middleware/rateLimiter.middleware");
const {
  staffLoginSchema,
  staffMfaLoginSchema,
  mfaVerifySetupSchema,
  updatePermissionsSchema,
  changeStaffPasswordSchema,
  staffIdParamSchema,
} = require("../validators/staff.validators");
const {
  createAccessRequestSchema,
  reviewAccessRequestSchema,
  accessRequestIdParamSchema,
} = require("../validators/accessRequest.validators");

const router = Router();

// IP allowlist gates the entire staff surface — checked before any
// credential is even read (off by default until ALLOWED_ADMIN_IPS +
// IP_ALLOWLIST_ENABLED=true are set, see ipAllowlist.middleware.js)
router.use(ipAllowlist);

// ---- Auth (no session required yet) ----
router.route("/login").post(authLimiter, validate({ body: staffLoginSchema }), loginStaff);
router.route("/mfa/login").post(authLimiter, validate({ body: staffMfaLoginSchema }), verifyMfaLogin);
router.route("/refresh-token").post(refreshStaffAccessToken);

// ---- Everything below requires a valid staff session ----
router.use(verifyStaffJWT);

router.route("/logout").post(logoutStaff);
router.route("/current-staff").get(getCurrentStaff);
router.route("/change-password").post(validate({ body: changeStaffPasswordSchema }), changeStaffPassword);

router.route("/mfa/setup").post(setupMfa);
router.route("/mfa/verify-setup").post(validate({ body: mfaVerifySetupSchema }), verifyMfaSetup);
router.route("/mfa/disable").post(disableMfa);

// ---- Staff management — superadmin only ----
router.route("/").get(verifySuperAdmin, getAllStaff);
router
  .route("/:staffId/permissions")
  .patch(
    verifySuperAdmin,
    validate({ params: staffIdParamSchema, body: updatePermissionsSchema }),
    updateStaffPermissions
  );
router.route("/:staffId/toggle-active").patch(verifySuperAdmin, validate({ params: staffIdParamSchema }), toggleStaffActive);

// ---- Provisioning workflow (Phase 4) — anyone with MANAGE_STAFF can
// request; only a superadmin (or another admin with MANAGE_STAFF) can
// review, but a requester can never review their own request (checked in
// the controller) ----
router
  .route("/access-requests")
  .post(verifyPermission("MANAGE_STAFF"), validate({ body: createAccessRequestSchema }), createAccessRequest)
  .get(verifyPermission("MANAGE_STAFF"), getAccessRequests);
router
  .route("/access-requests/:requestId/review")
  .patch(
    verifyPermission("MANAGE_STAFF"),
    validate({ params: accessRequestIdParamSchema, body: reviewAccessRequestSchema }),
    reviewAccessRequest
  );

// ---- Audit log — superadmin only, read-only ----
router.route("/audit-logs").get(verifySuperAdmin, getAuditLogs);

module.exports = router;
