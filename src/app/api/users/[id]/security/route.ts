import { body, handler } from "@/lib/server/route";
import { HttpError, audit, requireOrg, type DbUser } from "@/lib/server/auth";
import { get, run } from "@/lib/server/db";
import { clearEnrolment, createResetToken, isEnrolled, resetValidMinutes } from "@/lib/server/mfa";

interface SecurityBody { action: "reset-mfa" | "issue-password-reset" }

/**
 * The two things an administrator has to be able to do when a member of staff
 * is standing in front of them having lost a phone or forgotten a password.
 *
 * Both are deliberately administrator-only and both are logged as critical,
 * because either one is also exactly what an attacker who has taken over an
 * admin account would reach for. The audit line names who did it to whom.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await ctx.params;
    const { session, orgId } = await requireOrg("users.manage");
    const target = get<DbUser>("SELECT * FROM users WHERE id = ? AND org_id = ?", [id, orgId]);
    if (!target) throw new HttpError(404, "User not found in this hospital");
    const b = await body<SecurityBody>(req);

    if (b.action === "reset-mfa") {
      if (!isEnrolled(target)) throw new HttpError(400, "This account has no authenticator to reset.");
      clearEnrolment(target.id);
      /* Their sessions end too: a lost phone is a lost device, not a lost app. */
      run("DELETE FROM sessions WHERE user_id = ?", [target.id]);
      audit(
        session,
        "user.mfa_reset",
        `${target.name} (${target.email}) — must enrol a new authenticator at next sign-in`,
        "critical",
      );
      return { ok: true };
    }

    if (b.action === "issue-password-reset") {
      /*
       * Handed to the administrator rather than emailed, because this product
       * does not yet send email and pretending otherwise would leave staff
       * waiting for a message that never arrives. The admin gives the link to
       * the person they have just identified in front of them — which is a
       * stronger check than an inbox, not a weaker one.
       */
      const raw = createResetToken(target, session.user.email);
      audit(
        session,
        "user.password_reset_issued",
        `${target.name} (${target.email}) — link valid ${resetValidMinutes} minutes`,
        "critical",
      );
      return {
        ok: true,
        resetPath: `/reset?token=${raw}`,
        expiresInMinutes: resetValidMinutes,
        /* Stated plainly so nobody assumes the member of staff has been contacted. */
        note: "Give this link to the person yourself — nothing has been emailed.",
      };
    }

    throw new HttpError(400, "Unknown action");
  });
}
