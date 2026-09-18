// Self-ping keep-alive — the app pings its own public URL on a timer so the
// request itself counts as real inbound traffic to Render, resetting the
// free-tier's 15-minute inactivity clock. This runs inside the same Node
// process, so it doesn't depend on GitHub Actions' cron queue (which is
// best-effort and was observed slipping by hours) or any third-party pinger.
//
// RENDER_EXTERNAL_URL is set automatically by Render for every web service —
// we never hardcode the deployed URL. If it's absent (local dev, or hosted
// somewhere that doesn't set it), keep-alive simply doesn't start.

const PING_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — well under Render's 15-minute sleep window
const PING_TIMEOUT_MS = 10 * 1000;

const startKeepAlive = () => {
  const baseUrl = process.env.RENDER_EXTERNAL_URL;

  if (!baseUrl) {
    console.log("Keep-alive: RENDER_EXTERNAL_URL not set, skipping (expected in local dev)");
    return;
  }

  const pingUrl = `${baseUrl.replace(/\/$/, "")}/health`;

  const ping = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

    try {
      const res = await fetch(pingUrl, { signal: controller.signal });
      console.log(`Keep-alive ping -> ${res.status} (${new Date().toISOString()})`);
    } catch (err) {
      console.log(`Keep-alive ping failed -> ${err.message} (${new Date().toISOString()})`);
    } finally {
      clearTimeout(timeout);
    }
  };

  ping(); // fire once immediately so there's no gap between boot and the first confirmation
  setInterval(ping, PING_INTERVAL_MS);
  console.log(`Keep-alive started — pinging ${pingUrl} every 5 minutes`);
};

module.exports = startKeepAlive;