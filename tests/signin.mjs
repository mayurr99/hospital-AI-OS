/**
 * Signing in the way a member of staff actually does.
 *
 * Since a second factor is required of anyone who can open a patient record,
 * `POST /api/auth/login` no longer ends a sign-in by itself for a real hospital
 * — it says what is still owed. Rather than switching the requirement off for
 * the test suites, which would leave them testing a product nobody runs, this
 * plays the part of the person and their phone: it enrols the first time and
 * produces a code every time after.
 *
 * Demo hospitals are exempt from the requirement, so sign-ins with demo
 * accounts pass straight through here unchanged.
 */
import { freshCode } from "./totp-client.mjs";

/** email → the authenticator secret this helper enrolled for them. */
export const enrolledSecrets = new Map();

/**
 * Returns the final login response — the same shape the caller used to get
 * from `/api/auth/login`, so existing checks keep working.
 */
export async function signIn(client, email, password, orgId) {
  const first = await client.json("/api/auth/login", "POST", {
    email,
    password,
    ...(orgId ? { orgId } : {}),
  });
  if (!first.ok || !first.body?.needsMfa) return first;

  const challenge = first.body.challenge;

  if (first.body.mode === "enrol") {
    const setup = await client.json("/api/auth/mfa/setup", "POST", { challenge });
    const secret = setup.body?.secret;
    if (!secret) return setup;
    enrolledSecrets.set(email, secret);
    return client.json("/api/auth/mfa/enable", "POST", { challenge, code: await freshCode(secret) });
  }

  const secret = enrolledSecrets.get(email);
  if (!secret) {
    /* No authenticator on record here — hand the caller the challenge response
       rather than inventing a code, so the failure says what it really is. */
    return first;
  }
  return client.json("/api/auth/mfa/verify", "POST", { challenge, code: await freshCode(secret) });
}
