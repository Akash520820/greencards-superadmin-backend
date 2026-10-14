/**
 * Lifetime of the staff ACCESS token, from STAFF_ACCESS_TOKEN_EXPIRY.
 *
 * One value drives BOTH the JWT expiry and the cookie maxAge, so they can
 * never drift apart. Accepted format: <number><s|m|h>, e.g. 10m, 900s, 1h.
 * Clamped to 1 minute .. 1 hour. Missing or invalid value -> 15 minutes.
 */
const UNIT_SECONDS = { s: 1, m: 60, h: 3600 };
const DEFAULT_SECONDS = 15 * 60;

const getStaffAccessTtlSeconds = () => {
  const raw = String(process.env.STAFF_ACCESS_TOKEN_EXPIRY || "").trim();
  const match = /^(\d+)([smh])$/.exec(raw);
  if (!match) return DEFAULT_SECONDS;
  const seconds = Number(match[1]) * UNIT_SECONDS[match[2]];
  return Math.min(Math.max(seconds, 60), 3600);
};

module.exports = { getStaffAccessTtlSeconds, DEFAULT_SECONDS };
