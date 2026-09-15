import { body, handler } from "@/lib/server/route";
import {
  HttpError, destroyUserSessions, requireSession, toSessionUser, verifyPassword, type DbUser,
} from "@/lib/server/auth";
import { get, writeAudit } from "@/lib/server/db";
import { clearEnrolment, completeEnrolment, mfaStatus, verifyUserCode } from "@/lib/server/mfa";
import { generateBackupCodes } from "@/lib/server/totp";
import { callerIp } from "@/lib/server/ratelimit";

/** Where this account stands: required by policy, enrolled, codes left. */
export async function GET() {
  return handler(async () => {
    const session = await requireSession();
    const u = get<DbUser>("SELECT * FROM users WHERE id = ?", [session.user.id]);
    if (!u) throw new HttpError(401, "Not signed in");
    return { ok: true, status: mfaStatus(u, session.user) };
  });
}

interface ChangeBody { action: "disable" | "regenerate-backup-codes"; password: string; code: string }

/**
 * Turn the second factor off, or issue a fresh set of backup codes.
 *
 * Both require the password *and* a current code. The reason is the unattended
 * ward terminal: someone who walks up to a signed-in session should not be able
 * to strip the protection off the account, and requiring the factor itself is
 * what stops them.
 */
export async function POST(req: Request) {
  return handler(async () => {
    const b = await body<ChangeBody>(req);
    const session = await requireSession();
    const ip = callerIp(req);
    const u = get<DbUser>("SELECT * FROM users WHERE id = ?", [session.user.id]);
    if (!u) throw new HttpError(401, "Not signed in");

    const status = mfaStatus(u, session.user);
    if (!status.enrolled) throw new HttpError(400, "This account does not have an authenticator set up.");

    if (!verifyPassword(b.password ?? "", u.password_hash)) {
      writeAudit({
        orgId: u.org_id, actor: u.name, actorRole: u.role,
        action: "mfa.change_rejected", target: "wrong password", severity: "warning", ip,
      });
      throw new HttpError(401, "That password is not right.");
    }
    if (!verifyUserCode(u, b.code ?? "").ok) {
      writeAudit({
        orgId: u.org_id, actor: u.name, actorRole: u.role,
        action: "mfa.change_rejected", target: "wrong code", severity: "warning", ip,
      });
      throw new HttpError(401, "That code is not right.");
    }

    if (b.action === "regenerate-backup-codes") {
      const codes = generateBackupCodes();
      completeEnrolment(u.id, u.mfa_last_step ?? 0, codes);
      writeAudit({
        orgId: u.org_id, actor: u.name, actorRole: u.role,
        action: "mfa.backup_codes_regenerated", target: u.email, severity: "warning", ip,
      });
      /* The previous set stops working at this moment — the screen says so. */
      return { ok: true, backupCodes: codes };
    }

    /*
     * A user cannot opt out of a requirement their hospital set. Letting them
     * would make the administrator's control advisory, which is the exact
     * failure this whole piece of work exists to correct — only now it would be
     * the user, rather than the code, quietly ignoring it.
     */
    if (mfaStatus(u, toSessionUser(u)).required) {
      throw new HttpError(
        403,
        "Your hospital requires a second factor on this account. An administrator can reset it if you have lost your phone.",
      );
    }

    clearEnrolment(u.id);
    destroyUserSessions(u.id, session.token);
    writeAudit({
      orgId: u.org_id, actor: u.name, actorRole: u.role,
      action: "mfa.disabled", target: u.email, severity: "critical", ip,
    });
    return { ok: true };
  });
}
