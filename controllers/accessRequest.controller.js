const crypto = require("crypto");
const asyncHandler = require("../shared/utils/asyncHandler");
const ApiError = require("../shared/utils/ApiError");
const ApiResponse = require("../shared/utils/ApiResponse");
const AccessRequest = require("../models/accessRequest.model");
const Staff = require("../models/staff.model");
const { logAudit } = require("../shared/utils/auditLog.util");
const { DEFAULT_ADMIN_PERMISSIONS } = require("../shared/constants/permissions");

// ---- Create a request (either a brand-new staff account, or a JIT
// elevation extension). Never creates/modifies a Staff document itself —
// that only happens once the request has all required approvals ----
const createAccessRequest = asyncHandler(async (req, res) => {
  const body = req.body;

  if (body.type === "create_staff") {
    const existing = await Staff.findOne({ companyEmail: body.targetEmail });
    if (existing) {
      throw new ApiError(409, "A staff account with this email already exists");
    }
  }

  const requiredApprovals = body.requestedRole === "superadmin" ? 2 : 1;

  const accessRequest = await AccessRequest.create({
    ...body,
    requestedBy: req.staff._id,
    requiredApprovals,
  });

  await logAudit(
    req.staff,
    "access_request.create",
    { type: "AccessRequest", id: accessRequest._id },
    { requestType: body.type, requestedRole: body.requestedRole },
    req
  );

  return res.status(201).json(new ApiResponse(201, accessRequest, "Access request submitted"));
});

const getAccessRequests = asyncHandler(async (req, res) => {
  const { status = "pending" } = req.query;

  const filter = status === "all" ? {} : { status };
  const requests = await AccessRequest.find(filter)
    .populate("requestedBy", "fullName companyEmail")
    .populate("targetStaffId", "fullName companyEmail role")
    .populate("approvals.approverId", "fullName companyEmail")
    .sort({ createdAt: -1 });

  return res.status(200).json(new ApiResponse(200, requests, "Access requests fetched"));
});

// ---- Approve or reject. On the approval that satisfies requiredApprovals,
// resolves the request into an actual Staff document change. ----
const reviewAccessRequest = asyncHandler(async (req, res) => {
  const { requestId } = req.params;
  const { decision, comment } = req.body;

  const accessRequest = await AccessRequest.findById(requestId);
  if (!accessRequest) {
    throw new ApiError(404, "Access request not found");
  }
  if (accessRequest.status !== "pending") {
    throw new ApiError(409, `This request has already been ${accessRequest.status}`);
  }
  if (accessRequest.requestedBy.equals(req.staff._id)) {
    throw new ApiError(403, "You cannot review your own request");
  }
  const alreadyReviewed = accessRequest.approvals.some((a) => a.approverId.equals(req.staff._id));
  if (alreadyReviewed) {
    throw new ApiError(409, "You have already reviewed this request");
  }

  accessRequest.approvals.push({ approverId: req.staff._id, decision, comment });

  await logAudit(
    req.staff,
    "access_request.review",
    { type: "AccessRequest", id: accessRequest._id },
    { decision, comment },
    req
  );

  if (decision === "rejected") {
    accessRequest.status = "rejected";
    accessRequest.resolvedAt = new Date();
    await accessRequest.save();
    return res.status(200).json(new ApiResponse(200, accessRequest, "Request rejected"));
  }

  const approvalCount = accessRequest.approvals.filter((a) => a.decision === "approved").length;

  if (approvalCount < accessRequest.requiredApprovals) {
    // four-eyes: superadmin grants need a second distinct approver before anything happens
    await accessRequest.save();
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          accessRequest,
          `Approval recorded (${approvalCount}/${accessRequest.requiredApprovals}) — awaiting further approval`
        )
      );
  }

  // fully approved — resolve into an actual Staff change
  const result = await resolveApprovedRequest(accessRequest, req);

  accessRequest.status = "approved";
  accessRequest.resolvedAt = new Date();
  accessRequest.resultingStaffId = result.staff._id;
  if (result.tempPassword) {
    accessRequest.generatedTempPassword = result.tempPassword;
  }
  await accessRequest.save();

  const responseData = accessRequest.toObject();
  if (result.tempPassword) {
    // returned exactly once, in this response only — never retrievable again
    responseData.generatedTempPassword = result.tempPassword;
  }

  return res.status(200).json(new ApiResponse(200, responseData, "Request fully approved and applied"));
});

const resolveApprovedRequest = async (accessRequest, req) => {
  if (accessRequest.type === "create_staff") {
    const tempPassword = crypto.randomBytes(9).toString("base64url"); // 12-char random password, shared out-of-band by whoever created the account
    const staff = await Staff.create({
      fullName: accessRequest.targetFullName,
      companyEmail: accessRequest.targetEmail,
      password: tempPassword,
      role: accessRequest.requestedRole,
      permissions:
        accessRequest.requestedPermissions?.length > 0
          ? accessRequest.requestedPermissions
          : accessRequest.requestedRole === "admin"
          ? DEFAULT_ADMIN_PERMISSIONS
          : [],
      createdBy: accessRequest.requestedBy,
    });

    await logAudit(
      req.staff,
      "staff.create",
      { type: "Staff", id: staff._id },
      { role: staff.role, requestedBy: accessRequest.requestedBy },
      req
    );

    return { staff, tempPassword };
  }

  // extend_elevation
  const staff = await Staff.findById(accessRequest.targetStaffId);
  if (!staff) {
    throw new ApiError(404, "Target staff member no longer exists");
  }

  staff.previousRole = staff.role;
  staff.role = accessRequest.requestedRole;
  staff.roleExpiresAt = new Date(Date.now() + accessRequest.durationHours * 60 * 60 * 1000);
  await staff.save({ validateBeforeSave: false });

  await logAudit(
    req.staff,
    "role.jit_elevate",
    { type: "Staff", id: staff._id },
    { newRole: staff.role, expiresAt: staff.roleExpiresAt },
    req
  );

  return { staff };
};

module.exports = { createAccessRequest, getAccessRequests, reviewAccessRequest };
