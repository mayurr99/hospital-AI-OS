import { NextResponse } from "next/server";
import { body, handler } from "@/lib/server/route";
import { HttpError, destroyUserSessions, hashPassword, type DbUser } from "@/lib/server/auth";
import { get, run, writeAudit } from "@/lib/server/db";
import { findResetToken, markResetUsed } from "@/lib/server/mfa";
import { assertStrongPassword } from "@/lib/server/password-policy";
import { callerIp, hit, LOGIN_PER_IP } from "@/lib/server/ratelimit";

interface ResetBody { token: string; password: string }

/** Is this link still good? Used by the page to show the form or an explanation. */
export async function GET(req: Request) {
  return handler(async () => {
    const token = new URL(req.url).searchParams.get("token") ?? "";
    const row = findResetToken(token);
    if (!row) return { ok: false, valid: false };
    const user = get<{ name: string; email: string }>("SELECT name, email FROM users WHERE id = ?", [row.user_id]);
    /* Enough to show who the link is for — the person holding it already knows. */
    return { ok: true, valid: true, name: user?.name ?? "", email: user?.email ?? "" };
  });
}

export async function POST(req: Request) {
  return handler(async () => {
    const b = await body<ResetBody>(req);
    const ip = callerIp(req);

    const gate = hit(`reset:ip:${ip}`, LOGIN_PER_IP);
    if (!gate.allowed) {
      return NextResponse.json(
        { error: "Too many attempts from this connection. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
      );
    }

    const row = findResetToken(b.token ?? "");
    if (!row) throw new HttpError(400, "This reset link has expired or has already been used. Ask for a new one.");

    const user = get<DbUser>("SELECT * FROM users WHERE id = ?", [row.user_id]);
    if (!user || user.status === "suspended") {
      throw new HttpError(403, "This account is not active. Contact your administrator.");
    }

    assertStrongPassword(b.password, "New password");

    run("UPDATE users SET password_hash = ? WHERE id = ?", [hashPassword(b.password), user.id]);
    markResetUsed(row.id);

    /*
     * Everything signed in with the old password is ended.
     *
     * This is the reason a person resets a password in the first place: someone
     * else may have it. A reset that left the other party's week-old cookie
     * working would be a reassurance and nothing more.
     */
    destroyUserSessions(user.id);

    writeAudit({
      orgId: user.org_id, actor: user.name, actorRole: user.role,
      action: "user.password_reset_completed",
      target: `${user.email} — all sessions ended`,
      severity: "critical",
      ip,
    });

    /*
     * No session is issued here. The new password has to be used at the sign-in
     * screen, where the second factor is asked for — otherwise a reset link
     * would be a way round the very protection this work added.
     */
    return { ok: true, message: "Password changed. Sign in with your new password." };
  });
}
