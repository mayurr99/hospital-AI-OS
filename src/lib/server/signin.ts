/**
 * The last step of signing in, shared by the password route and the
 * second-factor route.
 *
 * It exists so there is exactly one place in the codebase that issues a session
 * cookie. When the same four lines are copied into three routes, the fourth
 * route eventually forgets one of them — and the line it forgets is the one
 * that decides whether a second factor was actually required.
 */

import { NextResponse } from "next/server";
import { createSession, setSessionCookie, toSessionUser, type DbUser } from "./auth";
import { get, writeAudit } from "./db";

export type Factor =
  | "password"
  | "password+totp"
  | "password+backup_code"
  | "password+email_otp"
  /*
   * A visitor who pressed "explore the demo hospital". No credential was
   * presented, and the audit line has to say so — recording it as "password"
   * would put a statement in the trail that is simply untrue, in the one record
   * a hospital would rely on to reconstruct who did what.
   */
  | "demo_visitor";

export async function completeSignIn(
  user: DbUser,
  ip: string,
  factor: Factor,
  extra: Record<string, unknown> = {},
) {
  const token = createSession(user.id, user.org_id, ip);
  await setSessionCookie(token);

  writeAudit({
    orgId: user.org_id,
    actor: user.name,
    actorRole: user.role,
    /*
     * The record says which factors were actually presented. An investigator
     * reading this line a year from now needs to know whether the account was
     * opened with a password alone or with a second factor, and the only way
     * that stays true is for the line to be written where the decision is made.
     */
    action: "login.success",
    target: `${user.email} (${factor})`,
    severity: factor === "password+backup_code" ? "warning" : "info",
    ip,
  });

  const onboarding = user.org_id
    ? get<{ completed: number }>("SELECT completed FROM onboarding WHERE org_id = ?", [user.org_id])
    : undefined;

  return NextResponse.json({
    ok: true,
    user: toSessionUser(user),
    next:
      user.role === "patient"
        ? "/portal"
        : onboarding && !onboarding.completed
          ? "/onboarding"
          : "/dashboard",
    ...extra,
  });
}
