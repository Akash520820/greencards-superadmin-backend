// Sends transactional email over HTTPS via Brevo's REST API, instead of raw
// SMTP (nodemailer). Render's free tier (and many other PaaS free tiers)
// blocks/can't reliably reach outbound SMTP ports (465/587), which caused
// ETIMEDOUT/CONN errors here even with correct Gmail credentials. HTTPS
// (port 443) is never blocked, so this is more reliable in production.
//
// Requires one env var: BREVO_API_KEY (from Brevo dashboard -> SMTP & API ->
// API Keys). EMAIL_FROM keeps its existing "Name <email>" format — the
// sender email inside it must be verified as a sender in Brevo first
// (Senders, Domains & Dedicated IPs -> Senders -> Add a sender).

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

// Parses "Ecommerce App <chakrabortyakash731@gmail.com>" into
// { name: "Ecommerce App", email: "chakrabortyakash731@gmail.com" }.
// Falls back to treating the whole string as a bare email if there's no
// "Name <email>" wrapper.
function parseFromHeader(fromHeader) {
  const match = fromHeader.match(/^(.*?)\s*<(.+)>$/);
  if (match) {
    return { name: match[1].trim() || undefined, email: match[2].trim() };
  }
  return { email: fromHeader.trim() };
}

const sendEmail = async ({ to, subject, html }) => {
  const sender = parseFromHeader(process.env.EMAIL_FROM);

  const response = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-key": process.env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender,
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Brevo send failed (${response.status}): ${errorBody}`);
  }
};

module.exports = sendEmail;