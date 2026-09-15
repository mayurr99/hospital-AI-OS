/**
 * A tiny TOTP client for the tests — deliberately written from RFC 6238 rather
 * than imported from the application.
 *
 * If the test used the app's own `currentCode`, it would prove only that the
 * code agrees with itself. Written separately, it plays the part of Google
 * Authenticator: if the server's implementation drifts from the standard, the
 * codes stop matching and the test fails, which is the entire point.
 */
import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

/** The six digits an authenticator app would be showing for `secret` right now. */
export function totp(secret, at = Date.now(), stepOffset = 0) {
  const counter = Math.floor(at / 1000 / 30) + stepOffset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[off] & 0x7f) << 24) | ((hmac[off + 1] & 0xff) << 16) |
    ((hmac[off + 2] & 0xff) << 8) | (hmac[off + 3] & 0xff);
  return String(bin % 1000000).padStart(6, "0");
}

/** Seconds until the current 30-second step ends. */
export function secondsLeftInStep(at = Date.now()) {
  return 30 - Math.floor(at / 1000) % 30;
}

/*
 * A code from a time step that has not been spent for this secret yet.
 *
 * The server refuses a code whose step it has already seen — that is what makes
 * a one-time password one-time — and it counts a code as spent even when the
 * operation it was presented to is refused for some other reason. A real person
 * waits for the next thirty-second window, so this waits too rather than
 * pretending a replayed code ought to work.
 *
 * Kept per secret, so signing two different people in back to back never waits.
 */
const lastStep = new Map();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stepNow = () => Math.floor(Date.now() / 1000 / 30);

export async function freshCode(secret) {
  while (stepNow() <= (lastStep.get(secret) ?? 0)) await wait(1000);
  if (secondsLeftInStep() < 3) await wait(3500);
  lastStep.set(secret, stepNow());
  return totp(secret);
}
