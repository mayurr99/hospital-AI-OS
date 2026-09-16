import { NextResponse } from "next/server";
import { body, handler } from "@/lib/server/route";
import { HttpError, listUsersByEmail, toSessionUser, verifyPassword } from "@/lib/server/auth";
import { createChallenge, createEmailChallenge, isEnrolled, mfaRequired } from "@/lib/server/mfa";
import { completeSignIn } from "@/lib/server/signin";
import { get, writeAudit } from "@/lib/server/db";
import { callerIp, clear, hit, LOGIN_PER_ACCOUNT, LOGIN_PER_IP } from "@/lib/server/ratelimit";
import { emailConfigured, maskedEmail, sendLoginOtp } from "@/lib/server/email";

interface LoginBody { email: string; password: string; orgId?: string }

export async function POST(req: Request) {
  return handler(async () => {
    const b = await body<LoginBody>(req);
    if (!b.email || !b.password) throw new HttpError(400, "Email and password are required");

    const email = b.email.trim().toLowerCase();
    const ip = callerIp(req);

    /*
     * Counted before the password is checked, because checking one is
     * deliberately expensive and the point is to make a refusal cheap.
     */
    const byAccount = hit(`login:acct:${email}`, LOGIN_PER_ACCOUNT);
    const byIp = hit(`login:ip:${ip}`, LOGIN_PER_IP);
    if (!byAccount.allowed || !byIp.allowed) {
      const retry = Math.max(byAccount.retryAfter, byIp.retryAfter);
      writeAudit({
        orgId: null, actor: email, actorRole: "patient",
        action: "login.rate_limited", target: email, severity: "warning", ip,
      });
      return NextResponse.json(
        { error: `Too many sign-in attempts. Try again in ${Math.ceil(retry / 60)} minute${retry > 60 ? "s" : ""}.` },
        { status: 429, headers: { "Retry-After": String(retry) } },
      );
    }

    const candidates = listUsersByEmail(email);
    const matching = candidates.filter((u) => verifyPassword(b.password, u.password_hash));

    /*
     * One message for both failures.
     *
     * Saying "no account found" for an unknown address and "incorrect password"
     * for a known one turns sign-in into a free directory of who works at the
     * hospital — useful to an attacker long before they guess a password, and
     * to anyone curious whether a particular person is a patient here.
     */
    if (!matching.length) {
      writeAudit({
        orgId: null, actor: email, actorRole: "patient",
        action: "login.failed", target: email, severity: "warning", ip,
      });
      throw new HttpError(401, "That email and password do not match an account");
    }

    /* one email may belong to more than one hospital — ask which */
    if (matching.length > 1 && !b.orgId) {
      const options = matching.map((u) => {
        const org = get<{ id: string; name: string }>("SELECT id, name FROM organizations WHERE id = ?", [u.org_id]);
        return { orgId: u.org_id, orgName: org?.name ?? "Platform", role: u.role };
      });
      return NextResponse.json({ needsOrgChoice: true, options });
    }

    const user = b.orgId ? matching.find((u) => u.org_id === b.orgId) ?? matching[0] : matching[0];
    if (user.status === "suspended") throw new HttpError(403, "This account has been suspended by your administrator");
    if (user.status === "invited") throw new HttpError(403, "This invitation has not been accepted yet");
    if (user.org_id) {
      const org = get<{ status: string }>("SELECT status FROM organizations WHERE id = ?", [user.org_id]);
      const subscription = get<{ status: string }>("SELECT status FROM subscriptions WHERE org_id = ?", [user.org_id]);
      if (!org || org.status === "suspended" || subscription?.status === "suspended" || subscription?.status === "cancelled") {
        throw new HttpError(403, "This hospital workspace is not active. Contact the platform administrator.");
      }
    }

    /* A successful sign-in forgives the attempts that led to it. */
    clear(`login:acct:${email}`);

    /*
     * The password is correct. Whether that is enough is the next question, and
     * it is answered before any session cookie exists — an account that owes a
     * second factor gets a challenge, not a shortened session or a flag on a
     * real one. A challenge opens nothing: it is a row in its own table that can
     * only be exchanged for a session by producing a code.
     */
    const sessionUser = toSessionUser(user);
    const enrolled = isEnrolled(user);
    const required = mfaRequired(sessionUser);

    /* Email OTP is opt-in at deployment level. It is useful where hospitals
       require a delivered code; authenticator TOTP remains the default because
       it does not depend on an inbox or an external provider. */
    if ((enrolled || required) && process.env.LOGIN_OTP_CHANNEL === "email") {
      if (!emailConfigured()) throw new HttpError(503, "Email sign-in codes are enabled but email delivery is not configured");
      const issued = createEmailChallenge(user.id, user.org_id, ip);
      try {
        await sendLoginOtp(user.email, issued.code);
      } catch (error) {
        writeAudit({
          orgId: user.org_id, actor: user.name, actorRole: user.role,
          action: "login.email_otp_delivery_failed", target: user.email, severity: "critical", ip,
        });
        console.error("[email] sign-in OTP delivery failed", error instanceof Error ? error.message : "unknown error");
        throw new HttpError(503, "The sign-in code could not be delivered. Try again or contact your administrator.");
      }
      writeAudit({
        orgId: user.org_id, actor: user.name, actorRole: user.role,
        action: "login.email_otp_sent", target: maskedEmail(user.email), ip,
      });
      return NextResponse.json({
        needsMfa: true, mode: "verify", channel: "email", challenge: issued.token,
        name: user.name, email: maskedEmail(user.email),
      });
    }

    if (enrolled || required) {
      const purpose = enrolled ? "verify" : "enrol";
      const challenge = createChallenge(user.id, user.org_id, purpose, ip);
      writeAudit({
        orgId: user.org_id,
        actor: user.name,
        actorRole: user.role,
        action: enrolled ? "login.mfa_challenged" : "login.mfa_enrolment_required",
        target: user.email,
        ip,
      });
      return NextResponse.json({
        needsMfa: true,
        mode: purpose,
        channel: "authenticator",
        challenge,
        /* Named so the sign-in screen can greet the right person without a second round trip. */
        name: user.name,
        email: user.email,
      });
    }

    return completeSignIn(user, ip, "password");
  });
}
