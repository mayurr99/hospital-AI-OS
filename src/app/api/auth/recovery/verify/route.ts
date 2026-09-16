import { NextResponse } from "next/server";
import { body, handler } from "@/lib/server/route";
import { HttpError } from "@/lib/server/auth";
import { get, writeAudit } from "@/lib/server/db";
import { createResetToken } from "@/lib/server/mfa";
import {
  consumeRecoveryChallenge, readRecoveryChallenge, recoveryAccounts, verifyRecoveryCode,
} from "@/lib/server/recovery";
import { callerIp, hit, LOGIN_PER_IP } from "@/lib/server/ratelimit";

interface VerifyBody { challenge: string; code?: string; userId?: string }

export async function POST(req: Request) {
  return handler(async () => {
    const b = await body<VerifyBody>(req);
    const ip = callerIp(req);
    const gate = hit(`recovery:ip:${ip}`, LOGIN_PER_IP);
    if (!gate.allowed) {
      return NextResponse.json(
        { error: "Too many recovery attempts. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
      );
    }

    const row = readRecoveryChallenge(b.challenge ?? "");
    if (!row) throw new HttpError(400, "That recovery code has expired. Request a new one.");

    if (!row.verified_at) {
      const result = verifyRecoveryCode(row, b.code ?? "");
      if (!result.ok) {
        throw new HttpError(401, result.attemptsLeft
          ? `That code is not right. ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? "" : "s"} left.`
          : "Too many wrong codes. Request a new one.");
      }
    }

    const accounts = recoveryAccounts(row);
    if (!accounts.length) throw new HttpError(400, "That recovery code has expired. Request a new one.");

    if (accounts.length > 1 && !b.userId) {
      return {
        ok: true,
        needsAccountChoice: true,
        accounts: accounts.map((u) => ({
          userId: u.id,
          hospital: u.org_id
            ? get<{ name: string }>("SELECT name FROM organizations WHERE id = ?", [u.org_id])?.name ?? "Hospital"
            : "Hospital AI OS platform",
          role: u.role,
        })),
      };
    }

    const user = b.userId ? accounts.find((u) => u.id === b.userId) : accounts[0];
    if (!user) throw new HttpError(403, "That account is not part of this recovery request.");
    const token = createResetToken(user, "verified_email_otp");
    consumeRecoveryChallenge(row.id);
    writeAudit({
      orgId: user.org_id, actor: user.name, actorRole: user.role,
      action: "user.password_recovery_verified", target: user.email, severity: "warning", ip,
    });
    return { ok: true, resetPath: `/reset?token=${encodeURIComponent(token)}` };
  });
}
