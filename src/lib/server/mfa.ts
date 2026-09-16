/**
 * Second-factor policy, enrolment and the sign-in challenge.
 *
 * Two different things were being conflated by one `mfa_enabled` column, and
 * separating them is most of the work here:
 *
 *   **Required** — the hospital's policy for this account. An administrator
 *   sets it; the user cannot clear it.
 *   **Enrolled** — this user has actually scanned a secret into an
 *   authenticator and proved they can produce a code from it.
 *
 * Required-but-not-enrolled is the interesting state, and it is the one a
 * decorative implementation gets wrong. The honest handling is that such a user
 * signs in and *cannot proceed to any patient data* until they enrol — so the
 * password alone still opens nothing. That is done by never issuing a session
 * cookie: the sign-in returns an enrolment challenge, the user enrols against
 * it, and only the code they produce at the end of that turns into a session.
 *
 * Who is required, by default: anyone who can see patient data. A hospital can
 * widen that to everyone, but it cannot quietly narrow it below the people
 * holding the records — the setting is a floor, not a dial.
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { all, get, id, nowIso, run, settings } from "./db";
import { hashBackupCode, hashOtpCode, matchBackupCode, matchOtpCode, verifyTotp } from "./totp";
import type { DbUser, SessionUser } from "./auth";
import { HttpError, effective, getSession } from "./auth";

/** How long a half-finished sign-in stays open. */
const CHALLENGE_MINUTES = 10;
/** Wrong codes allowed against one challenge before it is destroyed. */
const MAX_ATTEMPTS = 5;

export interface SecuritySettings {
  /** Require a second factor from every member of staff, not only clinical roles. */
  requireMfaForAllStaff: boolean;
}

export const DEFAULT_SECURITY: SecuritySettings = { requireMfaForAllStaff: false };

export function securityFor(orgId: string | null): SecuritySettings {
  if (!orgId) return DEFAULT_SECURITY;
  return { ...DEFAULT_SECURITY, ...settings.get<Partial<SecuritySettings>>(orgId, "security", {}) };
}

/**
 * Is a second factor required of this user?
 *
 * The floor: anyone who can read a patient record. A stolen password for such
 * an account is a stolen patient register, and that is precisely the account
 * the previous implementation left protected by a switch that did nothing.
 *
 * Patients signing into their own portal are outside the floor — the account
 * holds one person's own records, and forcing an authenticator app on a patient
 * to read their discharge summary would push them to write the password down
 * instead. An administrator can still require it per account.
 */
export function mfaRequired(user: SessionUser, security: SecuritySettings = securityFor(user.orgId)): boolean {
  if (user.role === "patient") return false;
  /*
   * Demo hospitals are exempt.
   *
   * Their data is synthetic, their password is printed on the sign-in screen,
   * and whether they exist at all is already a deployment decision. Demanding
   * an authenticator app to look at invented patients would protect nothing and
   * would stop anyone evaluating the product. Both the security screen and the
   * staff list say so rather than showing a green badge that means nothing.
   */
  if (isDemoOrg(user.orgId)) return false;
  /*
   * The platform account has no hospital of its own, and it can see every
   * hospital in the estate — so it is exactly the account that should not be
   * openable with a password alone.
   *
   * The single exception is a database that still contains demo hospitals.
   * That is an evaluation copy by definition: two hospitals of synthetic
   * patients whose shared password is printed on the sign-in screen. A real
   * deployment runs with SEED_DEMO=0 and never has any, so this exemption
   * cannot apply to it — and the system status page reports which kind of
   * database this is, so nobody has to take that on trust.
   */
  if (!user.orgId && hasDemoOrgs()) return false;

  if (user.mfaEnabled) return true; /* required for this account by an administrator */
  if (security.requireMfaForAllStaff) return true;

  /*
   * The floor, and the one way past it.
   *
   * Anyone who can open a patient record needs a second factor. A hospital
   * cannot switch that off from a settings screen — a control an administrator
   * can click past on a busy afternoon is how this became decorative the first
   * time. Whoever runs the server can lower it with MFA_FLOOR=off, which is a
   * deliberate, recorded deployment decision rather than a checkbox, and it
   * leaves the per-account requirement above still working.
   */
  if (process.env.MFA_FLOOR === "off") return false;
  return effective(user).has("patients.view");
}

/** Demo tenants are seeded with synthetic data and a published password. */
function isDemoOrg(orgId: string | null): boolean {
  if (!orgId) return false;
  const row = get<{ is_demo: number }>("SELECT is_demo FROM organizations WHERE id = ?", [orgId]);
  return Boolean(row?.is_demo);
}

/** Does this database hold demo hospitals at all? Exported for the status page. */
export function hasDemoOrgs(): boolean {
  return Boolean(get<{ n: number }>("SELECT COUNT(*) AS n FROM organizations WHERE is_demo = 1")?.n);
}

export function isEnrolled(u: DbUser): boolean {
  return Boolean(u.mfa_secret && u.mfa_confirmed_at);
}

export interface MfaStatus {
  required: boolean;
  enrolled: boolean;
  confirmedAt: string | null;
  backupCodesRemaining: number;
}

export function mfaStatus(u: DbUser, user: SessionUser): MfaStatus {
  let remaining = 0;
  try {
    remaining = (JSON.parse(u.mfa_backup_codes || "[]") as string[]).length;
  } catch {
    remaining = 0;
  }
  return {
    required: mfaRequired(user),
    enrolled: isEnrolled(u),
    confirmedAt: u.mfa_confirmed_at ?? null,
    backupCodesRemaining: remaining,
  };
}

/* --------------------------- challenges ---------------------------- */

export type ChallengePurpose = "verify" | "enrol";

export interface ChallengeRow {
  token: string;
  user_id: string;
  org_id: string | null;
  purpose: ChallengePurpose;
  attempts: number;
  ip: string;
  created_at: string;
  expires_at: string;
  delivery: "authenticator" | "email";
  code_hash: string | null;
}

export function createChallenge(
  userId: string,
  orgId: string | null,
  purpose: ChallengePurpose,
  ip = "",
): string {
  /* Housekeeping on the way past, so abandoned challenges do not accumulate. */
  run("DELETE FROM mfa_challenges WHERE expires_at < ?", [nowIso()]);
  const token = randomBytes(32).toString("hex");
  run(
    "INSERT INTO mfa_challenges (token, user_id, org_id, purpose, attempts, ip, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)",
    [
      token,
      userId,
      orgId,
      purpose,
      0,
      ip,
      nowIso(),
      new Date(Date.now() + CHALLENGE_MINUTES * 60000).toISOString(),
    ],
  );
  return token;
}

/** Create a password-verified challenge whose second factor is sent by email. */
export function createEmailChallenge(userId: string, orgId: string | null, ip = "") {
  run("DELETE FROM mfa_challenges WHERE expires_at < ?", [nowIso()]);
  const token = randomBytes(32).toString("hex");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  run(
    `INSERT INTO mfa_challenges
      (token, user_id, org_id, purpose, attempts, ip, created_at, expires_at, delivery, code_hash)
     VALUES (?,?,?,'verify',0,?,?,?,?,?)`,
    [token, userId, orgId, ip, nowIso(), new Date(Date.now() + CHALLENGE_MINUTES * 60000).toISOString(), "email", hashOtpCode(code)],
  );
  return { token, code };
}

export function readChallenge(token: string): ChallengeRow | null {
  if (!token || typeof token !== "string") return null;
  const row = get<ChallengeRow>("SELECT * FROM mfa_challenges WHERE token = ?", [token]);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    run("DELETE FROM mfa_challenges WHERE token = ?", [token]);
    return null;
  }
  return row;
}

export function destroyChallenge(token: string) {
  run("DELETE FROM mfa_challenges WHERE token = ?", [token]);
}

/** Record a wrong code. Returns false once the challenge has been used up and destroyed. */
export function recordFailedAttempt(row: ChallengeRow): boolean {
  const attempts = row.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    destroyChallenge(row.token);
    return false;
  }
  run("UPDATE mfa_challenges SET attempts = ? WHERE token = ?", [attempts, row.token]);
  return true;
}

export const attemptsAllowed = MAX_ATTEMPTS;

/* ---------------------------- verifying ---------------------------- */

export interface VerifyOutcome {
  ok: boolean;
  usedBackupCode: boolean;
  backupCodesRemaining: number;
}

/**
 * Check a code from an authenticator, or a backup code, against a user.
 *
 * Both are consumed on success: the TOTP step is recorded so the same six
 * digits cannot be replayed, and a backup code is deleted outright.
 */
export function verifyUserCode(u: DbUser, code: string): VerifyOutcome {
  const stored: string[] = (() => {
    try {
      return JSON.parse(u.mfa_backup_codes || "[]") as string[];
    } catch {
      return [];
    }
  })();

  if (u.mfa_secret) {
    const res = verifyTotp(u.mfa_secret, code, u.mfa_last_step ?? 0);
    if (res.ok) {
      run("UPDATE users SET mfa_last_step = ? WHERE id = ?", [res.step, u.id]);
      return { ok: true, usedBackupCode: false, backupCodesRemaining: stored.length };
    }
  }

  const idx = matchBackupCode(code, stored);
  if (idx >= 0) {
    const left = stored.filter((_, i) => i !== idx);
    run("UPDATE users SET mfa_backup_codes = ? WHERE id = ?", [JSON.stringify(left), u.id]);
    return { ok: true, usedBackupCode: true, backupCodesRemaining: left.length };
  }

  return { ok: false, usedBackupCode: false, backupCodesRemaining: stored.length };
}

export function verifyEmailCode(challenge: ChallengeRow, code: string): VerifyOutcome {
  const ok = Boolean(challenge.code_hash && matchOtpCode(code, challenge.code_hash));
  return { ok, usedBackupCode: false, backupCodesRemaining: 0 };
}

/* ---------------------------- enrolment ---------------------------- */

/**
 * Who is enrolling — resolved from a session, or from an enrolment challenge
 * for someone who has not got one yet.
 *
 * The second case is the whole reason this is not simply `requireSession()`. A
 * user whose hospital requires a second factor and who has never set one up has
 * no session and must not be given one until they do. They arrive holding an
 * enrolment challenge instead, and this is the only thing that will accept it.
 */
export async function enrolmentActor(
  challengeToken?: string,
): Promise<{ user: DbUser; challenge: ChallengeRow | null; sessionToken: string | null }> {
  if (challengeToken) {
    const challenge = readChallenge(challengeToken);
    if (!challenge || challenge.purpose !== "enrol") {
      throw new HttpError(401, "This sign-in has expired. Enter your email and password again.");
    }
    const user = get<DbUser>("SELECT * FROM users WHERE id = ?", [challenge.user_id]);
    if (!user || user.status !== "active") {
      destroyChallenge(challenge.token);
      throw new HttpError(401, "This sign-in has expired. Enter your email and password again.");
    }
    return { user, challenge, sessionToken: null };
  }

  const session = await getSession();
  if (!session) throw new HttpError(401, "Not signed in");
  const user = get<DbUser>("SELECT * FROM users WHERE id = ?", [session.user.id]);
  if (!user) throw new HttpError(401, "Not signed in");
  return { user, challenge: null, sessionToken: session.token };
}

/**
 * Stash a not-yet-confirmed secret against the user.
 *
 * It is written to `mfa_secret` with `mfa_confirmed_at` left null, and
 * `isEnrolled` requires both — so a secret that was generated and never
 * confirmed does not start challenging anybody, and starting enrolment again
 * simply replaces it.
 */
export function beginEnrolment(userId: string, secret: string) {
  run("UPDATE users SET mfa_secret = ?, mfa_confirmed_at = NULL, mfa_last_step = 0 WHERE id = ?", [secret, userId]);
}

/** Confirm enrolment and issue the one and only copy of the backup codes. */
export function completeEnrolment(userId: string, step: number, codes: string[]) {
  run("UPDATE users SET mfa_confirmed_at = ?, mfa_last_step = ?, mfa_backup_codes = ? WHERE id = ?", [
    nowIso(),
    step,
    JSON.stringify(codes.map(hashBackupCode)),
    userId,
  ]);
}

export function clearEnrolment(userId: string) {
  run(
    "UPDATE users SET mfa_secret = NULL, mfa_confirmed_at = NULL, mfa_last_step = 0, mfa_backup_codes = '[]' WHERE id = ?",
    [userId],
  );
}

/* ------------------------- password resets ------------------------- */

const RESET_MINUTES = 60;

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface ResetRow {
  id: string;
  user_id: string;
  org_id: string | null;
  token_hash: string;
  requested_by: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

/**
 * Issue a reset token and return the raw value — the only time it exists.
 *
 * Any outstanding token for the same user is invalidated first, so a link sent
 * an hour ago and forgotten in an inbox stops working the moment a new one is
 * requested.
 */
export function createResetToken(user: DbUser, requestedBy: string): string {
  run("DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL", [user.id]);
  const raw = randomBytes(32).toString("hex");
  run(
    "INSERT INTO password_resets (id, user_id, org_id, token_hash, requested_by, created_at, expires_at, used_at) VALUES (?,?,?,?,?,?,?,NULL)",
    [
      id("pwr"),
      user.id,
      user.org_id,
      hashResetToken(raw),
      requestedBy,
      nowIso(),
      new Date(Date.now() + RESET_MINUTES * 60000).toISOString(),
    ],
  );
  return raw;
}

/** The live, unused, unexpired reset row for a raw token, if there is one. */
export function findResetToken(raw: string): ResetRow | null {
  if (!raw || typeof raw !== "string") return null;
  const hash = hashResetToken(raw);
  const rows = all<ResetRow>("SELECT * FROM password_resets WHERE used_at IS NULL");
  const wanted = Buffer.from(hash, "hex");
  for (const row of rows) {
    const candidate = Buffer.from(row.token_hash, "hex");
    if (candidate.length === wanted.length && timingSafeEqual(candidate, wanted)) {
      if (new Date(row.expires_at).getTime() < Date.now()) return null;
      return row;
    }
  }
  return null;
}

export function markResetUsed(rowId: string) {
  run("UPDATE password_resets SET used_at = ? WHERE id = ?", [nowIso(), rowId]);
}

export const resetValidMinutes = RESET_MINUTES;
