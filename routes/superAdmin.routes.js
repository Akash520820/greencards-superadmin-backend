const { Router } = require("express");
const { getFullDashboard } = require("../controllers/superAdmin.controller");
const { verifyStaffJWT, verifySuperAdmin } = require("../shared/middleware/auth.middleware");

const router = Router();

// Staff account management (list/create/promote/deactivate/permissions)
// lives entirely under /api/v1/staff now — see staff.routes.js +
// accessRequest.controller.js. This router keeps only the read-only
// system-wide dashboard.
router.use(verifyStaffJWT, verifySuperAdmin);

router.route("/dashboard").get(getFullDashboard);

module.exports = router;
