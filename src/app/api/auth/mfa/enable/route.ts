import { NextResponse } from "next/server";
import { body, handler } from "@/lib/server/route";
import { HttpError, destroyUserSessions, type DbUser } from "@/lib/server/auth";
import { get, writeAudit } from "@/lib/server/db";
import { completeEnrolment, destroyChallenge, enrolmentActor } from "@/lib/server/mfa";
import { completeSignIn } from "@/lib/server/signin";
import { generateBackupCodes, verifyTotp } from "@/lib/server/totp";
import { callerIp } from "@/lib/server/ratelimit";

interface EnableBody { code: string; challenge?: string }

/**
 * Finish enrolment by proving the authenticator works.
 *
 * Confirming with a real code is not ceremony. Without it, a user who scanned a
 * blurred QR or whose phone clock is wrong would be enrolled into a factor they
 * cannot produce — and would discover it at the next sign-in, locked out of a
 * system they need in order to treat somebody.
 */
export async function POST(req: Request) {
  return handler(async () => {
    const b = await body<EnableBody>(req);
    const ip = callerIp(req);
    const { user, challenge, sessionToken } = await enrolmentActor(b.challenge);

    if (!user.mfa_secret) {
      throw new HttpError(400, "Start the setup again — there is no pending authenticator for this account.");
    }

    const res = verifyTotp(user.mfa_secret, b.code ?? "", 0);
    if (!res.ok) {
      writeAudit({
        orgId: user.org_id, actor: user.name, actorRole: user.role,
        action: "mfa.enrolment_code_rejected", target: user.email, severity: "warning", ip,
      });
      throw new HttpError(
        400,
        "That code is not right. Check the six digits showing in your authenticator app now, and that your phone's clock is set automatically.",
      );
    }

    const codes = generateBackupCodes();
    completeEnrolment(user.id, res.step, codes);

    /*
     * Every other session for this account ends here. Adding a second factor is
     * a statement that a password alone is no longer enough for this account;
     * leaving a week-old cookie alive somewhere would quietly contradict it.
     */
    destroyUserSessions(user.id, sessionToken ?? undefined);

    writeAudit({
      orgId: user.org_id, actor: user.name, actorRole: user.role,
      action: "mfa.enrolled", target: user.email, severity: "critical", ip,
    });

    /*
     * The codes are returned exactly once. They are stored only as hashes, so
     * this response is the sole copy that will ever exist — the screen says so
     * rather than implying they can be found again later.
     */
    if (challenge) {
      /* Enrolled during sign-in: the code just proved is the second factor. */
      destroyChallenge(challenge.token);
      const fresh = get<DbUser>("SELECT * FROM users WHERE id = ?", [user.id])!;
      return completeSignIn(fresh, ip, "password+totp", { backupCodes: codes, justEnrolled: true });
    }

    return NextResponse.json({ ok: true, backupCodes: codes, justEnrolled: true });
  });
}
