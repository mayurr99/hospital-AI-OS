/**
 * Load probe.
 *
 * Not a benchmark — a diagnostic. It answers three questions the clinical suites
 * cannot: what does a page load actually cost, which endpoints degrade as data
 * grows, and what happens when several staff write at the same instant.
 *
 *   node tests/load.mjs            # default 24 concurrent readers, 6 rounds
 *   CONC=64 ROUNDS=10 node tests/load.mjs
 */

const BASE = process.env.BASE ?? "http://localhost:3100";
const CONC = Number(process.env.CONC ?? 24);
const ROUNDS = Number(process.env.ROUNDS ?? 6);

function client() {
  let cookie = "";
  return {
    async req(path, init = {}) {
      const started = performance.now();
      const res = await fetch(BASE + path, {
        ...init,
        headers: {
          ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(init.headers ?? {}),
        },
        redirect: "manual",
      });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        if (pair.startsWith("hos_session=")) cookie = pair;
      }
      const text = await res.text();
      return { status: res.status, ok: res.ok, ms: performance.now() - started, bytes: text.length, text };
    },
    json(path, method, payload) {
      return this.req(path, { method, body: payload === undefined ? undefined : JSON.stringify(payload) });
    },
  };
}

async function login(email, password = "demo1234") {
  const c = client();
  const r = await c.json("/api/auth/login", "POST", { email, password });
  if (!r.ok) throw new Error(`login failed for ${email}: ${r.text.slice(0, 160)}`);
  return c;
}

function pct(values, p) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

const fmt = (n) => `${n.toFixed(0)}`.padStart(6);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`.padStart(9);

function report(label, samples, bytes, errors) {
  console.log(
    `  ${label.padEnd(30)} p50 ${fmt(pct(samples, 50))}ms   p95 ${fmt(pct(samples, 95))}ms   ` +
    `max ${fmt(Math.max(...samples))}ms   ${kb(bytes)}   ${errors ? `\x1b[31m${errors} errors\x1b[0m` : "ok"}`,
  );
  return { label, p50: pct(samples, 50), p95: pct(samples, 95), max: Math.max(...samples), bytes, errors };
}

/* ------------------------------------------------------------------ */

console.log(`\x1b[1mLoad probe\x1b[0m  ${BASE}  ·  ${CONC} concurrent readers × ${ROUNDS} rounds\n`);

const admin = await login("sunita.kale@democare.in");
const boot = await admin.req("/api/bootstrap");
console.log(`  workspace payload on every page load: \x1b[1m${(boot.bytes / 1024).toFixed(0)} KB\x1b[0m\n`);

/* --------------------------- read endpoints ------------------------ */
console.log("\x1b[1mRead endpoints under concurrency\x1b[0m");

const ENDPOINTS = [
  ["GET /api/bootstrap", "/api/bootstrap"],
  ["GET /api/collections", "/api/collections"],
  ["GET /api/patients", "/api/patients?limit=100"],
  ["GET /api/patients?q=", "/api/patients?q=a&limit=100"],
  ["GET /api/beds", "/api/beds"],
  ["GET /api/admissions", "/api/admissions?status=ACTIVE"],
  ["GET /api/lab/orders", "/api/lab/orders"],
  ["GET /api/lab/catalog", "/api/lab/catalog"],
];

const pool = [];
for (let i = 0; i < Math.min(CONC, 8); i++) pool.push(await login("sunita.kale@democare.in"));

const results = [];
for (const [label, path] of ENDPOINTS) {
  const samples = [];
  let errors = 0;
  let bytes = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const batch = await Promise.all(
      Array.from({ length: CONC }, (_, i) => pool[i % pool.length].req(path)),
    );
    for (const r of batch) {
      samples.push(r.ms);
      bytes = Math.max(bytes, r.bytes);
      if (!r.ok) errors++;
    }
  }
  results.push(report(label, samples, bytes, errors));
}

/* -------------------------- one patient chart ---------------------- */
const firstPatient = JSON.parse((await admin.req("/api/patients?limit=1")).text).items?.[0];
if (firstPatient) {
  const samples = [];
  let errors = 0, bytes = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const batch = await Promise.all(
      Array.from({ length: CONC }, (_, i) => pool[i % pool.length].req(`/api/patients/${firstPatient.id}`)),
    );
    for (const r of batch) {
      samples.push(r.ms);
      bytes = Math.max(bytes, r.bytes);
      if (!r.ok) errors++;
    }
  }
  results.push(report("GET /api/patients/:id", samples, bytes, errors));
}

/* ------------------------- concurrent writes ----------------------- */
console.log("\n\x1b[1mConcurrent writes — the real contention test\x1b[0m");

const nurse = await login("r.tambe@democare.in");
const patientsForVitals = JSON.parse((await nurse.req("/api/patients?limit=20")).text).items ?? [];

if (patientsForVitals.length) {
  const samples = [];
  let errors = 0;
  const problems = new Map();
  for (let round = 0; round < ROUNDS; round++) {
    const batch = await Promise.all(
      Array.from({ length: CONC }, (_, i) => {
        const p = patientsForVitals[i % patientsForVitals.length];
        return nurse.json(`/api/patients/${p.id}/vitals`, "POST", {
          pulse: 70 + (i % 20), systolic: 118 + (i % 10), diastolic: 76 + (i % 6),
        });
      }),
    );
    for (const r of batch) {
      samples.push(r.ms);
      if (!r.ok) {
        errors++;
        const key = /busy|locked/i.test(r.text) ? "SQLITE_BUSY / database is locked" : `HTTP ${r.status}`;
        problems.set(key, (problems.get(key) ?? 0) + 1);
      }
    }
  }
  report(`POST vitals × ${CONC}`, samples, 0, errors);
  for (const [k, n] of problems) console.log(`      \x1b[31m${n} × ${k}\x1b[0m`);
}

/* Every writer wants the same bed: exactly one may win, the rest must be told. */
const beds = JSON.parse((await nurse.req("/api/beds")).text).items ?? [];
const freeBed = beds.find((b) => b.status === "AVAILABLE");
const idle = (JSON.parse((await nurse.req("/api/patients?limit=60")).text).items ?? [])
  .filter((p) => !p.currentAdmission).slice(0, CONC);

if (freeBed && idle.length > 1) {
  const started = performance.now();
  const batch = await Promise.all(
    idle.map((p) => nurse.json("/api/admissions", "POST", { patientId: p.id, bedId: freeBed.id })),
  );
  const won = batch.filter((r) => r.ok).length;
  const refused = batch.filter((r) => r.status === 409).length;
  const broke = batch.filter((r) => !r.ok && r.status !== 409);
  console.log(
    `  ${`${idle.length} staff claim one bed`.padEnd(30)} ${won} won · ${refused} correctly refused · ` +
    `${broke.length ? `\x1b[31m${broke.length} failed with ${broke[0].status}\x1b[0m` : "0 errors"}   ` +
    `${(performance.now() - started).toFixed(0)}ms total`,
  );
  if (won !== 1) console.log(`      \x1b[31mexpected exactly 1 winner, got ${won}\x1b[0m`);
  if (broke.length) console.log(`      \x1b[31m${broke[0].text.slice(0, 160)}\x1b[0m`);
}

/* ------------------------------ summary ---------------------------- */
console.log("\n\x1b[1mWorst offenders\x1b[0m");
for (const r of [...results].sort((a, b) => b.p95 - a.p95).slice(0, 4)) {
  console.log(`  ${r.label.padEnd(30)} p95 ${fmt(r.p95)}ms   payload ${kb(r.bytes)}`);
}
console.log("");
