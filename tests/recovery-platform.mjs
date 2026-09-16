/** Black-box recovery OTP and platform subscription administration checks. */
import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync } from "node:crypto";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3100";
const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
const DB = path.join(DATA_DIR, "hospital-ai-os.db");
let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { if (ok) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); } else { failed++; console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ` — ${detail}` : ""}`); } };

function client() {
  let cookie = "";
  return {
    setSessionToken(token) { cookie = `hos_session=${token}`; },
    async json(p, method, value) {
      const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: value === undefined ? undefined : JSON.stringify(value), redirect: "manual" });
      for (const c of res.headers.getSetCookie?.() ?? []) if (c.startsWith("hos_session=")) cookie = c.split(";")[0];
      const text = await res.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
      return { ok: res.ok, status: res.status, body };
    },
  };
}

console.log("\x1b[1mRecovery OTP and platform administration\x1b[0m\n");
const uniq = Date.now().toString(36);
const email = `recovery+${uniq}@example.test`;
const password = "StrongOriginal123";
const account = client();
let r = await account.json("/api/auth/signup", "POST", { hospitalName: `OTP Hospital ${uniq}`, adminName: "Recovery Admin", email, password, city: "Pune" });
check("test hospital created", r.ok, JSON.stringify(r.body).slice(0, 100));

/* Insert what the email sender stores, then exercise only public endpoints. */
const code = "482731";
const challenge = randomBytes(32).toString("hex");
const salt = randomBytes(12).toString("hex");
const hash = `${salt}$${scryptSync(code, salt, 32, { N: 1 << 14, r: 8, p: 1 }).toString("hex")}`;
const db = new DatabaseSync(DB);
db.prepare(`INSERT INTO recovery_challenges (id,email,code_hash,attempts,verified_at,created_at,expires_at,used_at)
 VALUES (?,?,?,0,NULL,?,?,NULL)`).run(challenge, email, hash, new Date().toISOString(), new Date(Date.now() + 600_000).toISOString());
db.close();

r = await client().json("/api/auth/recovery/verify", "POST", { challenge, code: "000000" });
check("wrong recovery OTP refused", r.status === 401);
r = await client().json("/api/auth/recovery/verify", "POST", { challenge, code });
check("correct recovery OTP produces a single-use reset", r.ok && String(r.body.resetPath).startsWith("/reset?token="), JSON.stringify(r.body));
const token = new URL(`http://test${r.body.resetPath}`).searchParams.get("token");
r = await client().json("/api/auth/reset", "POST", { token, password: "ChangedPassword456" });
check("verified recovery changes the password", r.ok, JSON.stringify(r.body));
r = await client().json("/api/auth/recovery/verify", "POST", { challenge, code });
check("recovery OTP cannot be replayed", r.status === 400);
r = await client().json("/api/auth/login", "POST", { email, password: "ChangedPassword456" });
check("new password reaches the protected second-factor step", r.ok && r.body.needsMfa === true);

const platform = client();
r = await platform.json("/api/auth/login", "POST", { email: "mayur@hospitalai.os", password: "demo1234" });
check("platform administrator signed in", r.ok);
r = await platform.json("/api/platform/tenants", "GET");
const tenant = r.body.tenants?.find((t) => t.name === `OTP Hospital ${uniq}`);
check("platform console sees the new hospital and service status", r.ok && tenant?.services?.voice && tenant?.services?.storage);
if (tenant) {
  r = await platform.json("/api/platform/tenants", "PATCH", {
    orgId: tenant.id, plan: "front_desk", subscriptionStatus: "active", orgStatus: "active",
    seats: 25, voiceMinutesCap: 2500, monthlyFee: 19000, features: ["appointments", "billing", "analytics"],
  });
  check("platform administrator updates the subscription", r.ok, JSON.stringify(r.body));
  r = await platform.json("/api/platform/tenants", "GET");
  const changed = r.body.tenants?.find((t) => t.id === tenant.id);
  check("subscription update persisted", changed?.subscription?.plan === "front_desk" && changed?.subscription?.seats === 25 && changed?.subscription?.features?.length === 3);

  /* Password recovery deliberately revoked the signup session above. Create a
     known hospital-admin session so these checks prove role denial and live
     tenant suspension rather than merely proving that anonymous calls fail. */
  const tenantDb = new DatabaseSync(DB);
  const tenantUser = tenantDb.prepare("SELECT id, org_id FROM users WHERE email = ?").get(email);
  const tenantSession = randomBytes(32).toString("hex");
  tenantDb.prepare("INSERT INTO sessions (token,user_id,org_id,created_at,expires_at,ip) VALUES (?,?,?,?,?,?)")
    .run(tenantSession, tenantUser.id, tenantUser.org_id, new Date().toISOString(), new Date(Date.now() + 3600_000).toISOString(), "test");
  tenantDb.close();
  account.setSessionToken(tenantSession);

  r = await account.json("/api/platform/tenants", "PATCH", {
    orgId: tenant.id, plan: "front_desk", subscriptionStatus: "active", orgStatus: "active",
    seats: 25, voiceMinutesCap: 2500, monthlyFee: 150000, features: ["appointments"],
  });
  check("hospital administrator cannot use platform subscription API", r.status === 403);

  r = await platform.json("/api/platform/tenants", "PATCH", {
    orgId: tenant.id, plan: "front_desk", subscriptionStatus: "suspended", orgStatus: "suspended",
    seats: 25, voiceMinutesCap: 2500, monthlyFee: 150000, features: ["appointments"],
  });
  check("platform administrator can suspend a hospital", r.ok);
  r = await account.json("/api/bootstrap", "GET");
  check("suspension immediately revokes an existing hospital session", r.ok && r.body.authenticated === false);
  r = await client().json("/api/auth/login", "POST", { email, password: "ChangedPassword456" });
  check("suspended hospital cannot create a new session", r.status === 403);

  r = await platform.json("/api/platform/tenants", "PATCH", {
    orgId: tenant.id, plan: "front_desk", subscriptionStatus: "active", orgStatus: "active",
    seats: 25, voiceMinutesCap: 2500, monthlyFee: 150000, features: ["appointments", "billing", "analytics"],
  });
  check("platform administrator can reactivate a hospital", r.ok);
}

console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
if (failed) process.exitCode = 1;
