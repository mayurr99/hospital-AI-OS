import { NextResponse } from "next/server";
import { body, handler } from "@/lib/server/route";
import { HttpError, type DbUser } from "@/lib/server/auth";
import { get, writeAudit } from "@/lib/server/db";
import {
  attemptsAllowed, destroyChallenge, readChallenge, recordFailedAttempt, verifyUserCode,
} from "@/lib/server/mfa";
import { completeSignIn } from "@/lib/server/signin";
import { callerIp, hit, LOGIN_PER_IP } from "@/lib/server/ratelimit";

interface VerifyBody { challenge: string; code: string }

/**
 * Exchange a second factor for a session.
 *
 * This is the half of sign-in the product was missing. Everything the password
 * route learned is carried in the challenge row — deliberately, so that nothing
 * about which user is signing in travels through the browser where it could be
 * edited into somebody else's account.
 */
export async function POST(req: Request) {
  return handler(async () => {
    const b = await body<VerifyBody>(req);
    const ip = callerIp(req);

    /* Guessing six digits is cheap, so the per-IP budget applies here too. */
    const byIp = hit(`mfa:ip:${ip}`, LOGIN_PER_IP);
    if (!byIp.allowed) {
      return NextResponse.json(
        { error: `Too many attempts. Try again in ${Math.ceil(byIp.retryAfter / 60)} minutes.` },
        { status: 429, headers: { "Retry-After": String(byIp.retryAfter) } },
      );
    }

    const challenge = readChallenge(b.challenge);
    if (!challenge || challenge.purpose !== "verify") {
      throw new HttpError(401, "This sign-in has expired. Enter your email and password again.");
    }

    const user = get<DbUser>("SELECT * FROM users WHERE id = ?", [challenge.user_id]);
    if (!user) {
      destroyChallenge(challenge.token);
      throw new HttpError(401, "This sign-in has expired. Enter your email and password again.");
    }
    /* Suspension between password and code must still bite. */
    if (user.status !== "active") {
      destroyChallenge(challenge.token);
      throw new HttpError(403, "This account is not active. Contact your administrator.");
    }

    const result = verifyUserCode(user, b.code ?? "");
    if (!result.ok) {
      const alive = recordFailedAttempt(challenge);
      writeAudit({
        orgId: user.org_id, actor: user.name, actorRole: user.role,
        action: "login.mfa_failed", target: user.email, severity: "warning", ip,
      });
      const left = alive ? attemptsAllowed - (challenge.attempts + 1) : 0;
      throw new HttpError(
        401,
        alive
          ? `That code is not right. ${left} attempt${left === 1 ? "" : "s"} left before you have to sign in again.`
          : "Too many wrong codes. Enter your email and password again.",
      );
    }

    /* Single use: the challenge is gone whether or not the session sticks. */
    destroyChallenge(challenge.token);

    if (result.usedBackupCode) {
      writeAudit({
        orgId: user.org_id, actor: user.name, actorRole: user.role,
        action: "login.mfa_backup_code_used",
        target: `${user.email} — ${result.backupCodesRemaining} code${result.backupCodesRemaining === 1 ? "" : "s"} left`,
        severity: "warning",
        ip,
      });
    }

    /*
     * When a backup code was spent, say so on screen as well as in the audit
     * log. Someone who has just used one of ten needs to know how many are left
     * while they are still thinking about it, not at the point where there are
     * none and they are locked out.
     */
    return completeSignIn(
      user,
      ip,
      result.usedBackupCode ? "password+backup_code" : "password+totp",
      result.usedBackupCode
        ? { usedBackupCode: true, backupCodesRemaining: result.backupCodesRemaining }
        : {},
    );
  });
}
