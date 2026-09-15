/**
 * One password policy, applied everywhere a password is chosen.
 *
 * It was previously enforced only at sign-up. A password set through any other
 * door — an administrator creating an account, and now a reset — bypassed it
 * entirely, which meant the rule was really "the first password must be ten
 * characters", and every subsequent one could be `1234`.
 */

import { HttpError } from "./auth";

/** The passwords that turn up first in every credential-stuffing list. */
export const WEAK_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwertyuiop", "qwerty123", "letmein123", "welcome123", "admin@123", "hospital123",
  "demo1234", "changeme", "iloveyou", "abc123456", "passw0rd", "p@ssw0rd",
]);

export const MIN_LENGTH = 10;

/** Throws an HttpError describing what is wrong, or returns silently. */
export function assertStrongPassword(password: string | undefined, context = "Password") {
  if (!password || password.length < MIN_LENGTH) {
    throw new HttpError(400, `${context} must be at least ${MIN_LENGTH} characters`);
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    throw new HttpError(400, "That password is too common. Choose something harder to guess.");
  }
}
