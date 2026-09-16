import { NextResponse } from "next/server";
import { body, handler } from "@/lib/server/route";
import { listUsersByEmail } from "@/lib/server/auth";
import { writeAudit } from "@/lib/server/db";
import { callerIp, hit, LOGIN_PER_IP } from "@/lib/server/ratelimit";
import { emailConfigured, sendRecoveryOtp } from "@/lib/server/email";
import { createRecoveryChallenge, fakeRecoveryChallenge } from "@/lib/server/recovery";

interface ForgotBody { email: string }

/**
 * "I have forgotten my password."
 *
 * Two things this route deliberately does not do.
 *
 * **It does not say whether the address is known.** Every answer is identical,
 * so this cannot be used to find out who works at the hospital, or who is a
 * patient here. That is why the response talks about "if that address belongs
 * to an account" rather than confirming anything.
 *
 * When transactional email is configured, a one-time code is sent. Without it,
 * the existing administrator-assisted recovery remains available and the UI is
 * explicit about which mode this deployment is using.
 */
export async function POST(req: Request) {
  return handler(async () => {
    const b = await body<ForgotBody>(req);
    const ip = callerIp(req);
    const email = (b.email ?? "").trim().toLowerCase();

    const gate = hit(`forgot:ip:${ip}`, LOGIN_PER_IP);
    if (!gate.allowed) {
      return NextResponse.json(
        { error: "Too many requests from this connection. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
      );
    }

    const mailReady = emailConfigured();
    const same: { ok: true; message: string; delivery: "email" | "administrator"; challenge?: string } = {
      ok: true,
      delivery: mailReady ? "email" : "administrator",
      message: mailReady
        ? "If that address belongs to an active account, a one-time recovery code has been sent."
        : "If that address belongs to an account, your hospital's administrators have been asked to issue a reset link. They will give it to you directly — nothing is emailed.",
    };

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      if (mailReady) same.challenge = fakeRecoveryChallenge();
      return same;
    }

    const users = listUsersByEmail(email);
    /* No account: identical response, no record written, nothing to time. */
    if (!users.length) {
      if (mailReady) same.challenge = fakeRecoveryChallenge();
      return same;
    }

    if (mailReady) {
      const issued = createRecoveryChallenge(email);
      same.challenge = issued.challenge;
      try {
        await sendRecoveryOtp(email, issued.code);
      } catch (error) {
        console.error("[email] recovery OTP delivery failed", error instanceof Error ? error.message : "unknown error");
        for (const u of users) {
          writeAudit({
            orgId: u.org_id, actor: u.name, actorRole: u.role,
            action: "user.password_recovery_delivery_failed", target: u.email, severity: "critical", ip,
          });
        }
      }
    }

    for (const u of users) {
      if (u.status === "suspended") continue;
      writeAudit({
        orgId: u.org_id,
        actor: u.name,
        actorRole: u.role,
        action: "user.password_reset_requested",
        target: mailReady ? `${u.email} — email OTP requested` : `${u.email} — waiting for an administrator to issue a link`,
        severity: "warning",
        ip,
      });
    }
    return same;
  });
}
