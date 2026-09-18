// Fixed permission set for staff RBAC. Superadmin bypasses this list
// entirely (see Staff.hasPermission) — these are for scoping what a
// regular "admin" is allowed to do, so "admin" stops meaning "can do
// everything admin-ish."
const ALL_PERMISSIONS = [
  "MANAGE_SELLERS", // approve/reject/suspend sellers, verify bank details
  "MANAGE_USERS", // activate/deactivate customer & seller accounts (not staff — that's MANAGE_STAFF)
  "MANAGE_INVENTORY", // create/edit/delete products & categories as staff
  "VIEW_FINANCIALS", // dashboard revenue stats, order financial data
  "MANAGE_STAFF", // create/promote/deactivate staff accounts, review access requests
  "MODERATE_REVIEWS", // hide/unhide reviews
  "MANAGE_SITE_CONTENT", // homepage/site content editing
  "MANAGE_ORDERS", // view all orders, update order status
  "MANAGE_RETURNS", // review returns, process refunds
  "MANAGE_COUPONS", // create/edit coupons
  "VIEW_CONTACT_MESSAGES", // read/respond to contact form submissions
];

// Sensible defaults applied to a brand-new "admin" — deliberately narrow;
// a superadmin can widen this per-person from the dashboard.
const DEFAULT_ADMIN_PERMISSIONS = ["MANAGE_ORDERS", "MODERATE_REVIEWS", "VIEW_CONTACT_MESSAGES"];

module.exports = { ALL_PERMISSIONS, DEFAULT_ADMIN_PERMISSIONS };
