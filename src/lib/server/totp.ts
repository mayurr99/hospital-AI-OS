/**
 * Time-based one-time passwords (RFC 6238) and single-use backup codes.
 *
 * Why this exists: the product already had an "MFA enabled" switch on every
 * user. It was stored, displayed in the admin list, and **nothing anywhere in
 * the sign-in path ever asked for a second factor**. An administrator could
 * turn it on for every account in the hospital and feel protected while a
 * single stolen password still opened the whole patient register. That is a
 * worse position than having no switch at all, because someone signs a policy
 * document on the strength of it.
 *
 * Implemented here rather than pulled from a package because the algorithm is
 * forty lines and the dependency surface of an authentication library is not
 * something to take on lightly. It follows RFC 6238 exactly: HMAC-SHA1 over the
 * counter, dynamic truncation, six digits, a thirty-second step — the defaults
 * every authenticator app assumes.
 *
 * Deliberate choices worth stating:
 *
 *   **±1 step of drift.** A phone clock is rarely exact. One step either side
 *   accepts a code up to thirty seconds old or early, which is the standard
 *   tolerance. Wider windows are how "one-time" quietly becomes "valid for two
 *   minutes".
 *
 *   **Replay is refused.** A correct code is recorded against the user; the
 *   same step cannot be used twice. Shoulder-surfing a six-digit code is easy;
 *   making it useless the instant it is spent is the point of the scheme.
 *
 *   **Backup codes are hashed.** They are passwords, not settings. They are
 *   shown to the user exactly once, stored only as scrypt hashes, and consumed
 *   on use. A hospital admin reading the database cannot use one to sign in as
 *   a doctor.
 */

import { createHmac, randomBytes, randomInt, timingSafeEqual, scryptSync } from "node:crypto";

const DIGITS = 6;
export const STEP_SECONDS = 30;
/** How many steps either side of now are accepted (clock drift). */
const DRIFT = 1;

/* ----------------------------- base32 ----------------------------- */
/* Authenticator apps speak base32, not hex. RFC 4648, no padding. */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/* ------------------------------ totp ------------------------------ */

/** A fresh 20-byte secret, the size RFC 4226 recommends for HMAC-SHA1. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

function codeForCounter(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  /* Counter is 64-bit; JavaScript numbers are safe well past any real clock. */
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** The code an authenticator would show right now — used by tests, never by a route. */
export function currentCode(secretBase32: string, at = Date.now()): string {
  return codeForCounter(base32Decode(secretBase32), Math.floor(at / 1000 / STEP_SECONDS));
}

export interface TotpResult {
  ok: boolean;
  /** The time step the code belonged to, so it can be recorded and refused next time. */
  step: number;
}

/**
 * Check a code against the secret.
 *
 * `lastUsedStep` is the step of the last code this user successfully spent.
 * Passing it is what makes a code genuinely one-time: a code from that step or
 * earlier is refused even though the maths still checks out.
 */
export function verifyTotp(secretBase32: string, code: string, lastUsedStep = 0, at = Date.now()): TotpResult {
  const digits = (code ?? "").replace(/\D/g, "");
  if (digits.length !== DIGITS) return { ok: false, step: 0 };
  const secret = base32Decode(secretBase32);
  if (!secret.length) return { ok: false, step: 0 };

  const now = Math.floor(at / 1000 / STEP_SECONDS);
  for (let d = -DRIFT; d <= DRIFT; d++) {
    const step = now + d;
    if (step <= lastUsedStep) continue; /* already spent */
    const expected = Buffer.from(codeForCounter(secret, step));
    const given = Buffer.from(digits);
    if (expected.length === given.length && timingSafeEqual(expected, given)) {
      return { ok: true, step };
    }
  }
  return { ok: false, step: 0 };
}

/** The `otpauth://` URI an authenticator app scans. */
export function otpauthUri(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* --------------------------- backup codes -------------------------- */

const BACKUP_COUNT = 10;
/* Cheaper than a password hash on purpose: these are 10 random characters from
 * a 32-symbol alphabet (~50 bits), not something a person invented, so the
 * dictionary attack that justifies N=2^17 does not apply. Ten of them are
 * verified on every attempt, and a full-cost hash ten times over would make a
 * wrong code take seconds. */
const BACKUP_SCRYPT = { N: 1 << 14, r: 8, p: 1 };

/** Ten single-use codes, in the readable `abcde-fghij` shape people transcribe. */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_COUNT; i++) {
    let raw = "";
    for (let c = 0; c < 10; c++) raw += ALPHABET[randomInt(ALPHABET.length)].toLowerCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

export function hashBackupCode(code: string): string {
  const salt = randomBytes(12).toString("hex");
  const norm = code.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `${salt}$${scryptSync(norm, salt, 32, BACKUP_SCRYPT).toString("hex")}`;
}

/** Hash a short, server-generated OTP. Its strict six-digit format is checked by the caller. */
export function hashOtpCode(code: string): string {
  const salt = randomBytes(12).toString("hex");
  return `${salt}$${scryptSync(code, salt, 32, BACKUP_SCRYPT).toString("hex")}`;
}

export function matchOtpCode(code: string, stored: string): boolean {
  if (!/^\d{6}$/.test(code ?? "")) return false;
  const [salt, expected] = String(stored).split("$");
  if (!salt || !expected) return false;
  const derived = scryptSync(code, salt, 32, BACKUP_SCRYPT);
  const expectedBuf = Buffer.from(expected, "hex");
  return derived.length === expectedBuf.length && timingSafeEqual(derived, expectedBuf);
}

/**
 * Find which stored backup hash a code matches, or -1.
 *
 * The caller removes that entry — a backup code works once, which is what makes
 * writing them on a card acceptable.
 */
export function matchBackupCode(code: string, hashes: string[]): number {
  const norm = (code ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (norm.length < 8) return -1;
  for (let i = 0; i < hashes.length; i++) {
    const [salt, expected] = String(hashes[i]).split("$");
    if (!salt || !expected) continue;
    const derived = scryptSync(norm, salt, 32, BACKUP_SCRYPT);
    const expectedBuf = Buffer.from(expected, "hex");
    if (derived.length === expectedBuf.length && timingSafeEqual(derived, expectedBuf)) return i;
  }
  return -1;
}
