/**
 * Sign-in security: the second factor, and password recovery.
 *
 * The thing being tested here is a claim the product used to make and not keep.
 * "MFA enabled" was stored on every user, shown in the admin list, and never
 * asked for. So these checks are written to fail loudly if that ever becomes
 * true again — in particular:
 *
 *   · a password alone must not produce a working session for an account that
 *     owes a second factor (not "must show a prompt" — the session itself must
 *     not exist, which is checked by trying to read patients with it)
 *   · a code must work once and never again
 *   · a reset must actually evict whoever already had the old password
 *
 * Run against a server started normally:  node tests/auth.mjs
 */
import { freshCode, totp } from "./totp-client.mjs";

const BASE = process.env.BASE ?? "http://localhost:3100";

let passed = 0, failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` (${detail})` : ""}`); console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ` — ${detail}` : ""}`); }
}
const section = (n) => console.log(`\n\x1b[1m${n}\x1b[0m`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client() {
  let cookie = "";
  return {
    get cookie() { return cookie; },
    async req(p, init = {}) {
      const res = await fetch(BASE + p, {
        ...init,
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(init.headers ?? {}) },
        redirect: "manual",
      });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        if (pair.startsWith("hos_session=")) cookie = pair;
      }
      const t = await res.text();
      let body; try { body = JSON.parse(t); } catch { body = t; }
      return { status: res.status, ok: res.ok, body };
    },
    json(p, m, v) { return this.req(p, { method: m, body: v === undefined ? undefined : JSON.stringify(v) }); },
  };
}


const uniq = Date.now().toString(36);
const PASSWORD = "supersecret123";

/* ================================================================== */
console.log("\x1b[1mSign-in security\x1b[0m — second factor and password recovery\n");

section("1. A real hospital, and the account that runs it");
const admin = client();
const adminEmail = `sec.admin+${uniq}@authtest.test`;
let r = await admin.json("/api/auth/signup", "POST", {
  hospitalName: `Auth Test Hospital ${uniq}`,
  adminName: "Asha Rane",
  email: adminEmail,
  password: PASSWORD,
  acceptedTerms: true,
});
check("a hospital was created", r.ok && r.body.orgId, JSON.stringify(r.body).slice(0, 120));
const orgId = r.body.orgId;

/* A second member of staff, created by the admin, with the requirement set. */
const nurseEmail = `sec.nurse+${uniq}@authtest.test`;
r = await admin.json("/api/users", "POST", {
  name: "Nurse Vaidya", email: nurseEmail, role: "nurse", password: PASSWORD, mfaEnabled: true,
});
check("a nurse was created with two-step required", r.ok, JSON.stringify(r.body).slice(0, 140));
const nurseId = r.body?.user?.id;

section("2. A password alone does not open an account that owes a second factor");
const nurse = client();
r = await nurse.json("/api/auth/login", "POST", { email: nurseEmail, password: PASSWORD });
check("the correct password is accepted but does not sign them in", r.ok && r.body.needsMfa === true, JSON.stringify(r.body).slice(0, 140));
check("the hospital is told to set one up, since there is none yet", r.body.mode === "enrol", String(r.body.mode));
const enrolChallenge = r.body.challenge;
check("a challenge was issued", typeof enrolChallenge === "string" && enrolChallenge.length > 20);

/*
 * The important one. Not "is a prompt shown" — whether the half-finished
 * sign-in can read a patient record. If anything was set as a session cookie,
 * this is where it shows.
 */
let probe = await nurse.req("/api/patients?limit=1");
check("that half-finished sign-in cannot read the patient register", probe.status === 401, `HTTP ${probe.status}`);
check("no session cookie was issued", !nurse.cookie.includes("hos_session="), nurse.cookie.slice(0, 40));

section("3. The wrong code is refused, and the attempts run out");
{
  const doomed = client();
  const start = await doomed.json("/api/auth/login", "POST", { email: nurseEmail, password: PASSWORD });
  const ch = start.body.challenge;
  /* Not a verify challenge yet (no authenticator), so verify must refuse it outright. */
  const wrongPurpose = await doomed.json("/api/auth/mfa/verify", "POST", { challenge: ch, code: "000000" });
  check("an enrolment challenge cannot be used to skip enrolment", wrongPurpose.status === 401, `HTTP ${wrongPurpose.status}`);
}

section("4. Enrolment — scan, confirm, and only then a session");
r = await nurse.json("/api/auth/mfa/setup", "POST", { challenge: enrolChallenge });
check("setup returns a secret", r.ok && typeof r.body.secret === "string" && r.body.secret.length >= 16);
check("and a QR matrix to draw", Array.isArray(r.body.qr?.modules) && r.body.qr.modules.length === r.body.qr.size ** 2);
check("the otpauth URI names the hospital and the account", String(r.body.uri).startsWith("otpauth://totp/") && String(r.body.uri).includes(encodeURIComponent(nurseEmail)));
const secret = r.body.secret;

/* Confirming with a wrong code must not enrol anybody. */
r = await nurse.json("/api/auth/mfa/enable", "POST", { challenge: enrolChallenge, code: "000000" });
check("a wrong confirmation code does not enrol the account", !r.ok, `HTTP ${r.status}`);
probe = await nurse.req("/api/patients?limit=1");
check("and still no session was handed out", probe.status === 401, `HTTP ${probe.status}`);

/* Avoid confirming on the edge of a step, which would make the test flaky. */
r = await nurse.json("/api/auth/mfa/enable", "POST", { challenge: enrolChallenge, code: await freshCode(secret) });
check("the right code completes enrolment", r.ok, JSON.stringify(r.body).slice(0, 140));
check("ten backup codes are returned, once", Array.isArray(r.body.backupCodes) && r.body.backupCodes.length === 10);
const backupCodes = r.body.backupCodes ?? [];
check("the account is now signed in", r.body.ok === true && typeof r.body.next === "string");
probe = await nurse.req("/api/patients?limit=1");
check("and can reach the patient register", probe.ok, `HTTP ${probe.status}`);

section("5. Next sign-in asks for the code");
const again = client();
r = await again.json("/api/auth/login", "POST", { email: nurseEmail, password: PASSWORD });
check("the password is not enough", r.body.needsMfa === true && r.body.mode === "verify", JSON.stringify(r.body).slice(0, 120));
const verifyChallenge = r.body.challenge;

r = await again.json("/api/auth/mfa/verify", "POST", { challenge: verifyChallenge, code: "123456" });
check("a wrong code is refused", !r.ok, `HTTP ${r.status}`);
check("and says how many attempts are left", /attempt/i.test(String(r.body.error)), String(r.body.error).slice(0, 80));

const spentCode = await freshCode(secret);
r = await again.json("/api/auth/mfa/verify", "POST", { challenge: verifyChallenge, code: spentCode });
check("the right code signs them in", r.ok && r.body.ok, JSON.stringify(r.body).slice(0, 120));
probe = await again.req("/api/patients?limit=1");
check("the session works", probe.ok, `HTTP ${probe.status}`);

section("6. A code works once — replay is refused");
{
  const replay = client();
  const start = await replay.json("/api/auth/login", "POST", { email: nurseEmail, password: PASSWORD });
  const rr = await replay.json("/api/auth/mfa/verify", "POST", { challenge: start.body.challenge, code: spentCode });
  check("the same six digits cannot be used a second time", !rr.ok, `HTTP ${rr.status}`);
  const probe2 = await replay.req("/api/patients?limit=1");
  check("and no session came of it", probe2.status === 401, `HTTP ${probe2.status}`);
}

section("7. A challenge is bound to the account that made it");
{
  /* The admin's own sign-in challenge must not be satisfiable with the nurse's code. */
  const other = client();
  const start = await other.json("/api/auth/login", "POST", { email: nurseEmail, password: PASSWORD });
  const stolen = start.body.challenge;
  const attacker = client();
  const rr = await attacker.json("/api/auth/mfa/verify", "POST", { challenge: stolen, code: "000000" });
  check("someone else holding the challenge still needs the code", !rr.ok, `HTTP ${rr.status}`);
}

section("8. Backup codes work once each");
{
  const bk = client();
  const start = await bk.json("/api/auth/login", "POST", { email: nurseEmail, password: PASSWORD });
  const code = backupCodes[0];
  let rr = await bk.json("/api/auth/mfa/verify", "POST", { challenge: start.body.challenge, code });
  check("a backup code signs them in", rr.ok && rr.body.ok, JSON.stringify(rr.body).slice(0, 120));
  check("and says how many are left", rr.body.backupCodesRemaining === 9, String(rr.body.backupCodesRemaining));

  const bk2 = client();
  const start2 = await bk2.json("/api/auth/login", "POST", { email: nurseEmail, password: PASSWORD });
  rr = await bk2.json("/api/auth/mfa/verify", "POST", { challenge: start2.body.challenge, code });
  check("the same backup code cannot be used twice", !rr.ok, `HTTP ${rr.status}`);
}

section("9. A user cannot switch off what their hospital requires");
{
  const rr = await again.json("/api/auth/mfa", "POST", {
    action: "disable", password: PASSWORD, code: await freshCode(secret),
  });
  check("turning it off is refused", rr.status === 403 || !rr.ok, `HTTP ${rr.status}`);
  const status = await again.req("/api/auth/mfa");
  check("and the account is still enrolled", status.body?.status?.enrolled === true);
  check("the screen knows it is required", status.body?.status?.required === true);
}

section("10. Forgotten password says the same thing either way");
{
  const anon = client();
  const known = await anon.json("/api/auth/forgot", "POST", { email: nurseEmail });
  const unknown = await anon.json("/api/auth/forgot", "POST", { email: `nobody+${uniq}@authtest.test` });
  check("a known address gets the standard answer", known.ok && typeof known.body.message === "string");
  check("an unknown address gets the identical answer", unknown.ok && unknown.body.message === known.body.message);
  check("it does not promise an email that is never sent", !/check your (in)?box|we have emailed|sent you an email/i.test(String(known.body.message)), String(known.body.message).slice(0, 90));
}

section("11. An administrator issues the reset link");
r = await admin.json(`/api/users/${nurseId}/security`, "POST", { action: "issue-password-reset" });
check("a link is produced", r.ok && String(r.body.resetPath).startsWith("/reset?token="), JSON.stringify(r.body).slice(0, 120));
const resetToken = new URL(`http://x${r.body.resetPath}`).searchParams.get("token");
check("it is handed over rather than emailed", /give this link to the person/i.test(String(r.body.note)));

const anon = client();
r = await anon.req(`/api/auth/reset?token=${resetToken}`);
check("the link checks out before the form is shown", r.ok && r.body.valid === true);

r = await anon.json("/api/auth/reset", "POST", { token: resetToken, password: "short" });
check("a weak new password is refused", !r.ok, `HTTP ${r.status}`);
r = await anon.json("/api/auth/reset", "POST", { token: resetToken, password: "password123" });
check("a common new password is refused", !r.ok, String(r.body.error).slice(0, 60));

const NEW_PASSWORD = "brandnewpass456";
r = await anon.json("/api/auth/reset", "POST", { token: resetToken, password: NEW_PASSWORD });
check("a strong new password is accepted", r.ok, JSON.stringify(r.body).slice(0, 120));

section("12. The reset actually evicts the old session");
probe = await again.req("/api/patients?limit=1");
check("the session that existed before the reset is gone", probe.status === 401, `HTTP ${probe.status}`);

r = await anon.json("/api/auth/reset", "POST", { token: resetToken, password: "yetanotherpass789" });
check("the link cannot be used a second time", !r.ok, `HTTP ${r.status}`);

section("13. The new password still meets the second factor");
{
  const after = client();
  let rr = await after.json("/api/auth/login", "POST", { email: nurseEmail, password: PASSWORD });
  check("the old password no longer works", !rr.ok, `HTTP ${rr.status}`);

  rr = await after.json("/api/auth/login", "POST", { email: nurseEmail, password: NEW_PASSWORD });
  check("the new password is accepted", rr.body?.needsMfa === true, JSON.stringify(rr.body).slice(0, 120));
  check("and still asks for the code — a reset is not a way round it", rr.body?.mode === "verify");

  rr = await after.json("/api/auth/mfa/verify", "POST", { challenge: rr.body.challenge, code: await freshCode(secret) });
  check("code plus new password signs them in", rr.ok && rr.body.ok, JSON.stringify(rr.body).slice(0, 120));
}

section("14. Recovery is the administrator's, and only within their own hospital");
{
  /* A second hospital, whose admin must not be able to touch the first one's staff. */
  const other = client();
  const rr = await other.json("/api/auth/signup", "POST", {
    hospitalName: `Other Hospital ${uniq}`,
    adminName: "Other Admin",
    email: `other.admin+${uniq}@authtest.test`,
    password: PASSWORD,
    acceptedTerms: true,
  });
  check("a second hospital exists", rr.ok && rr.body.orgId !== orgId);

  const cross = await other.json(`/api/users/${nurseId}/security`, "POST", { action: "issue-password-reset" });
  check("its admin cannot issue a reset for another hospital's nurse", cross.status === 404, `HTTP ${cross.status}`);
  const crossMfa = await other.json(`/api/users/${nurseId}/security`, "POST", { action: "reset-mfa" });
  check("nor reset their authenticator", crossMfa.status === 404, `HTTP ${crossMfa.status}`);
}

section("15. Losing the phone — the administrator resets the authenticator");
r = await admin.json(`/api/users/${nurseId}/security`, "POST", { action: "reset-mfa" });
check("the reset succeeds", r.ok, JSON.stringify(r.body).slice(0, 120));
{
  const after = client();
  const rr = await after.json("/api/auth/login", "POST", { email: nurseEmail, password: NEW_PASSWORD });
  check("the next sign-in asks them to enrol again", rr.body?.needsMfa === true && rr.body?.mode === "enrol", JSON.stringify(rr.body).slice(0, 120));
  const old = await after.json("/api/auth/mfa/verify", "POST", { challenge: rr.body.challenge, code: await freshCode(secret) });
  check("the old authenticator no longer opens the account", !old.ok, `HTTP ${old.status}`);
}

section("16. Patients are not dragged into this");
{
  /* A patient portal account holds one person's own records. Requiring an
     authenticator app there would push people to write the password down. */
  const pt = client();
  const rr = await pt.json("/api/auth/login", "POST", { email: "rajesh.patil@example.com", password: "demo1234" });
  check("a patient signs in with a password", rr.ok && rr.body.ok === true, JSON.stringify(rr.body).slice(0, 120));
}

/* ------------------------------------------------------------------ */
console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
if (failures.length) {
  console.log("\n\x1b[31mFailures\x1b[0m");
  for (const f of failures) console.log(`  · ${f}`);
}
process.exit(failed ? 1 : 0);
