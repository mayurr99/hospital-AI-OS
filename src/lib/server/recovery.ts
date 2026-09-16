import { randomBytes, randomInt } from "node:crypto";
import { all, get, nowIso, run } from "./db";
import { hashOtpCode, matchOtpCode } from "./totp";
import type { DbUser } from "./auth";

const MINUTES = 10;
const MAX_ATTEMPTS = 5;

export interface RecoveryChallenge {
  id: string;
  email: string;
  code_hash: string;
  attempts: number;
  verified_at: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export function createRecoveryChallenge(email: string) {
  run("DELETE FROM recovery_challenges WHERE expires_at < ? OR used_at IS NOT NULL", [nowIso()]);
  run("DELETE FROM recovery_challenges WHERE lower(email) = lower(?)", [email]);
  const challenge = randomBytes(32).toString("hex");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  run(
    `INSERT INTO recovery_challenges
      (id, email, code_hash, attempts, verified_at, created_at, expires_at, used_at)
     VALUES (?,?,?,0,NULL,?,?,NULL)`,
    [challenge, email, hashOtpCode(code), nowIso(), new Date(Date.now() + MINUTES * 60000).toISOString()],
  );
  return { challenge, code };
}

export function fakeRecoveryChallenge() {
  return randomBytes(32).toString("hex");
}

export function readRecoveryChallenge(challenge: string): RecoveryChallenge | null {
  const row = get<RecoveryChallenge>("SELECT * FROM recovery_challenges WHERE id = ? AND used_at IS NULL", [challenge]);
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

export function verifyRecoveryCode(row: RecoveryChallenge, code: string) {
  if (!matchOtpCode(code, row.code_hash)) {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) run("UPDATE recovery_challenges SET used_at = ? WHERE id = ?", [nowIso(), row.id]);
    else run("UPDATE recovery_challenges SET attempts = ? WHERE id = ?", [attempts, row.id]);
    return { ok: false, attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts) };
  }
  run("UPDATE recovery_challenges SET verified_at = ? WHERE id = ?", [nowIso(), row.id]);
  return { ok: true, attemptsLeft: MAX_ATTEMPTS - row.attempts };
}

export function recoveryAccounts(row: RecoveryChallenge) {
  return all<DbUser>("SELECT * FROM users WHERE lower(email) = lower(?) AND status = 'active' ORDER BY created_at", [row.email]);
}

export function consumeRecoveryChallenge(idValue: string) {
  run("UPDATE recovery_challenges SET used_at = ? WHERE id = ?", [nowIso(), idValue]);
}

export const recoveryValidMinutes = MINUTES;
