import { NextResponse } from "next/server";
import { body, handler } from "@/lib/server/route";
import { listUsersByEmail } from "@/lib/server/auth";
import { writeAudit } from "@/lib/server/db";
import { callerIp, hit, LOGIN_PER_IP } from "@/lib/server/ratelimit";

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
 * **It does not claim to have sent an email.** The product has no mail
 * transport configured, and a message saying "check your inbox" would leave a
 * nurse refreshing an inbox at the start of a shift for something that is never
 * coming. What actually happens is recorded for the hospital's administrators,
 * who issue the link — and the wording on screen says exactly that.
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

    const same = {
      ok: true,
      message:
        "If that address belongs to an account, your hospital's administrators have been asked to issue a reset link. " +
        "They will give it to you directly — nothing is emailed.",
    };

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return same;

    const users = listUsersByEmail(email);
    /* No account: identical response, no record written, nothing to time. */
    if (!users.length) return same;

    for (const u of users) {
      if (u.status === "suspended") continue;
      writeAudit({
        orgId: u.org_id,
        actor: u.name,
        actorRole: u.role,
        action: "user.password_reset_requested",
        target: `${u.email} — waiting for an administrator to issue a link`,
        severity: "warning",
        ip,
      });
    }
    return same;
  });
}
