/**
 * Disaster recovery drill.
 *
 * This is the test that decides whether the backup script is worth anything.
 * Taking a backup is easy and everybody does it; restoring one under pressure is
 * where hospitals lose their records, and an untested restore is a hope rather
 * than a plan.
 *
 * So this does the whole thing for real, against the running database:
 *
 *   1. record what is in the system now
 *   2. take a backup
 *   3. write more data, so the backup is demonstrably behind
 *   4. destroy the database — actually delete it
 *   5. restore
 *   6. verify the pre-backup data is back, and that the post-backup data is
 *      correctly absent (a restore that appeared to recover work taken after the
 *      snapshot would mean it had not really restored anything)
 *
 * It stops the server to do it, because restoring underneath a live process is
 * the mistake the restore script exists to prevent.
 *
 *   node tests/disaster.mjs
 */
import { execFileSync, spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3100";
const PORT = Number(new URL(BASE).port || 3100);
const ROOT = process.cwd();
const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, ".data");
const DB_PATH = path.join(DATA_DIR, "hospital-ai-os.db");
const BACKUP_ROOT = path.join(ROOT, ".drill-backups");

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
const login = async (email, password = "demo1234") => {
  const c = client();
  const r = await c.json("/api/auth/login", "POST", { email, password });
  if (!r.ok) throw new Error(`login ${email}: ${JSON.stringify(r.body).slice(0, 140)}`);
  return c;
};

/** Count rows straight from the file, so the check does not depend on the app. */
function countInFile(table) {
  const db = new DatabaseSync(DB_PATH);
  try { return db.prepare(`SELECT count(*) c FROM ${table}`).get().c; }
  catch { return -1; }
  finally { db.close(); }
}

async function serverUp(timeoutMs = 40000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${BASE}/login`, { redirect: "manual" });
      if (r.status < 500) return true;
    } catch { /* not yet */ }
    await wait(700);
  }
  return false;
}

function stopServer() {
  try { execFileSync("pkill", ["-f", "next-server"], { stdio: "pipe" }); } catch { /* none running */ }
}

function startServer() {
  const child = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: ROOT, detached: true, stdio: "ignore",
    env: { ...process.env, RATE_LIMIT_SIGNUP_PER_IP: "500", RATE_LIMIT_LOGIN_PER_ACCOUNT: "500", RATE_LIMIT_LOGIN_PER_IP: "2000" },
  });
  child.unref();
}

/* ================================================================== */
console.log("\x1b[1mDisaster recovery drill\x1b[0m — backup, destroy, restore, verify\n");

section("1. What is in the system before anything happens");
const admin = await login("sunita.kale@democare.in");
const before = {
  patients: (await admin.req("/api/patients?limit=1")).body.total,
  files: { patients: countInFile("patients"), labOrders: countInFile("lab_orders"), charges: countInFile("charges") },
};
console.log(`   patients ${before.files.patients} · lab orders ${before.files.labOrders} · charges ${before.files.charges}`);
check("the system has data worth losing", before.files.patients > 0);

section("2. Take a backup");
fs.rmSync(BACKUP_ROOT, { recursive: true, force: true });
execFileSync("node", ["scripts/backup.mjs", BACKUP_ROOT], { cwd: ROOT, stdio: "pipe" });
const generations = fs.readdirSync(BACKUP_ROOT).filter((d) => /^\d{4}/.test(d));
check("a backup was written", generations.length === 1, `${generations.length} directories`);
const backupDir = path.join(BACKUP_ROOT, generations[0]);
const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, "manifest.json"), "utf8"));
check("it verified its own integrity", manifest.integrity === "ok");
check("it recorded what it contains", manifest.rowCounts.patients === before.files.patients,
  `${manifest.rowCounts.patients} vs ${before.files.patients}`);

section("3. Record a patient AFTER the backup — this must NOT come back");
const marker = `Drill${Date.now().toString(36)}`;
const created = await admin.json("/api/patients", "POST", {
  firstName: marker, lastName: "Postbackup", gender: "female", dateOfBirth: "1990-04-04", mobile: "9812345678",
});
check("the post-backup patient was created", created.ok, JSON.stringify(created.body).slice(0, 120));
const afterBackupCount = countInFile("patients");
check("the database now holds more than the backup", afterBackupCount > before.files.patients,
  `${afterBackupCount} vs ${before.files.patients}`);

section("4. Destroy the database");
stopServer();
await wait(2500);
for (const suffix of ["", "-wal", "-shm"]) {
  const f = DB_PATH + suffix;
  if (fs.existsSync(f)) fs.rmSync(f);
}
check("the database file is gone", !fs.existsSync(DB_PATH));

section("5. Restore");
let restoreOut = "";
try {
  restoreOut = execFileSync("node", ["scripts/restore.mjs", backupDir, "--yes"], { cwd: ROOT, encoding: "utf8" });
} catch (e) {
  restoreOut = String(e.stdout ?? "") + String(e.stderr ?? "");
}
check("the restore reported success", /Restore complete/.test(restoreOut), restoreOut.split("\n").slice(-4).join(" ").slice(0, 160));
check("it verified integrity after writing", /Integrity/.test(restoreOut) && !/DO NOT match/.test(restoreOut));

section("6. Verify what came back");
check("the database exists again", fs.existsSync(DB_PATH));
check("patients are back", countInFile("patients") === before.files.patients,
  `${countInFile("patients")} vs ${before.files.patients}`);
check("lab orders are back", countInFile("lab_orders") === before.files.labOrders);
check("charges are back", countInFile("charges") === before.files.charges);
/* The point of this one: if the post-backup patient reappeared, the restore did
   not actually replace the file and every other check above is meaningless. */
check("work recorded after the backup is correctly absent",
  countInFile("patients") === before.files.patients && countInFile("patients") < afterBackupCount);

section("7. The hospital can work again");
startServer();
const up = await serverUp();
check("the application starts on the restored database", up);
if (up) {
  const again = await login("sunita.kale@democare.in");
  const list = await again.req("/api/patients?limit=5");
  check("staff can sign in", list.ok);
  check("and the patient register is readable", (list.body.items ?? []).length > 0, `total ${list.body.total}`);
  const gone = await again.req(`/api/patients?q=${marker}`);
  check("the post-backup patient is not there", (gone.body.total ?? 0) === 0, `total ${gone.body.total}`);
}

section("8. Encryption at rest is real, not a toggle");
{
  const keyed = Boolean(process.env.STORAGE_ENCRYPTION_KEY);
  const admin2 = await login("sunita.kale@democare.in");
  const ex = await admin2.json("/api/exports", "POST", { template: "patients", maskPhone: false, includeClinical: true });
  check("an export containing patient data was produced", ex.ok, JSON.stringify(ex.body).slice(0, 120));

  const job = ex.body?.job;
  if (job) {
    const onDisk = path.join(DATA_DIR, "recordings", "org_democare", "exports", `${job.id}.csv`);
    const raw = fs.existsSync(onDisk) ? fs.readFileSync(onDisk) : Buffer.alloc(0);
    const readable = /UH20|MRN|Name,Age/i.test(raw.subarray(0, 4096).toString("latin1"));

    if (keyed) {
      check("the file on disk is not readable as patient data", raw.length > 0 && !readable);
      check("it carries the encrypted-object marker", raw.subarray(0, 6).toString() === "HAOS1:", raw.subarray(0, 6).toString());
    } else {
      /* Without a key the product must say so rather than imply protection it
         does not have — writing plaintext is correct here, claiming otherwise
         is not. */
      check("without a key the file is plaintext, as documented", raw.length > 0 && readable);
    }

    const dl = await admin2.req(`/api/exports/${job.id}/download?token=${job.downloadToken}`);
    check("the app still reads it back correctly", dl.ok && /MRN|Name/i.test(String(dl.body).slice(0, 200)),
      String(dl.body).slice(0, 80));
  }
}

/* ------------------------------------------------------------------ */
fs.rmSync(BACKUP_ROOT, { recursive: true, force: true });
/* Tidy the copies the restore set aside, so a drill does not fill the disk. */
for (const f of fs.readdirSync(DATA_DIR)) {
  if (f.includes(".replaced-")) fs.rmSync(path.join(DATA_DIR, f), { recursive: true, force: true });
}

console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
if (failures.length) {
  console.log("\n\x1b[31mFailures\x1b[0m");
  for (const f of failures) console.log(`  · ${f}`);
}
process.exit(failed ? 1 : 0);
