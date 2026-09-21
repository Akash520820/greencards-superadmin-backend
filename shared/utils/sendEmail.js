const nodemailer = require("nodemailer");

// ─── Dual-Mode Email Sender ──────────────────────────────────────────────────
// 1. If BREVO_API_KEY is present, sends via Brevo REST API over HTTPS (port 443).
//    Recommended on Render Free Tier where outbound SMTP ports 465/587 are blocked.
//
// 2. If EMAIL_USER and EMAIL_PASS are present, sends via Nodemailer Gmail SMTP.
//    Matches your past monolithic configuration.
//
// Required env vars:
//   EMAIL_FROM: "GreenCard <your_email@gmail.com>"
//   Either (EMAIL_USER + EMAIL_PASS) OR BREVO_API_KEY
// ─────────────────────────────────────────────────────────────────────────────

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

function parseFromHeader(fromHeader) {
  if (!fromHeader) return { email: process.env.EMAIL_USER || "noreply@greencard.com" };
  const match = fromHeader.match(/^(.*?)\s*<(.+)>$/);
  if (match) {
    return { name: match[1].trim() || undefined, email: match[2].trim() };
  }
  return { email: fromHeader.trim() };
}

// Nodemailer reusable transporter (Gmail / SMTP)
let smtpTransporter = null;
function getSmtpTransporter() {
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }
  return smtpTransporter;
}

const sendEmail = async ({ to, subject, html }) => {
  // Option 1: Brevo REST API (HTTPS - never blocked by cloud firewalls)
  if (process.env.BREVO_API_KEY) {
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
    return;
  }

  // Option 2: Standard Gmail Nodemailer (EMAIL_USER & EMAIL_PASS)
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    const transporter = getSmtpTransporter();
    const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER;

    await transporter.sendMail({
      from: fromAddress,
      to,
      subject,
      html,
    });
    return;
  }

  // Fallback: Neither configured
  console.warn(`[sendEmail] Email to ${to} skipped — neither BREVO_API_KEY nor EMAIL_USER/EMAIL_PASS are configured.`);
};

module.exports = sendEmail;