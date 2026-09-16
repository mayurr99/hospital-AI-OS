/** Transactional email through Resend's HTTPS API — no SMTP process or SDK. */

const RESEND_URL = "https://api.resend.com/emails";

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export function maskedEmail(email: string) {
  const [local, domain = ""] = email.split("@");
  const shown = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${shown}${"•".repeat(Math.max(2, local.length - shown.length))}@${domain}`;
}

async function send(to: string, subject: string, text: string) {
  if (!emailConfigured()) throw new Error("Transactional email is not configured");
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text }),
  });
  if (!res.ok) throw new Error(`Email provider returned ${res.status}`);
}

export function sendLoginOtp(to: string, code: string) {
  return send(
    to,
    "Your Hospital AI OS sign-in code",
    `Your sign-in code is ${code}. It expires in 10 minutes and works once.\n\nIf you did not try to sign in, do not share this code and contact your administrator.`,
  );
}

export function sendRecoveryOtp(to: string, code: string) {
  return send(
    to,
    "Your Hospital AI OS password recovery code",
    `Your password recovery code is ${code}. It expires in 10 minutes and works once.\n\nIf you did not request this, do not share the code. Your password has not been changed.`,
  );
}
