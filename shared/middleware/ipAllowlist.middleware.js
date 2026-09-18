const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { logAudit } = require("../utils/auditLog.util");

// Restricts staff-facing routes to a configured set of IPs. Off by
// default (IP_ALLOWLIST_ENABLED unset/"false") so local development and
// initial deployment aren't locked out — turn it on in production once
// ALLOWED_ADMIN_IPS is set to your own real IP(s)/office network/VPN
// range. This is deliberately a static allowlist rather than real VPN
// infrastructure (see the chat discussion on why a VPS + WireGuard is
// the honest next step if you want literal VPN-gated access).
const ipAllowlist = asyncHandler(async (req, res, next) => {
  const enabled = process.env.IP_ALLOWLIST_ENABLED === "true";
  if (!enabled) return next();

  const allowed = (process.env.ALLOWED_ADMIN_IPS || "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);

  if (allowed.length === 0) return next(); // nothing configured — fail open rather than lock everyone out

  const requestIp = req.ip;

  if (!allowed.includes(requestIp)) {
    // req.staff won't exist yet if this runs before verifyStaffJWT (it
    // should — block before even checking credentials), so log with
    // whatever identity info is available rather than requiring an actor.
    await logAudit(
      { _id: null, companyEmail: "unknown" },
      "ip.blocked",
      { type: "AccessAttempt" },
      { path: req.originalUrl, ip: requestIp },
      req
    );
    throw new ApiError(403, "Access to this resource is restricted to allowlisted networks");
  }

  next();
});

module.exports = { ipAllowlist };
