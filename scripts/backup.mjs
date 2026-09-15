#!/usr/bin/env node
/**
 * Take a consistent backup of the database and stored recordings.
 *
 * There was no backup story at all, which for a system holding the only copy of
 * a hospital's patient records is the single largest risk in the whole project —
 * larger than any of the security findings, because a breach is recoverable and
 * a lost database is not.
 *
 * Copying a live SQLite file with `cp` is not safe: a write in progress produces
 * a torn copy that may restore, may not, and gives no warning either way. This
 * uses SQLite's own `VACUUM INTO`, which writes a consistent snapshot while the
 * application keeps serving.
 *
 *   node scripts/backup.mjs                    # → ./backups/<timestamp>/
 *   node scripts/backup.mjs /mnt/backups       # somewhere else
 *   KEEP=14 node scripts/backup.mjs            # keep 14 generations, not 7
 *
 * Restoring is deliberately manual: stop the app, put the .db file back, start
 * it. Automatic restore is how a good backup becomes a bad one.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
const DB_PATH = process.env.DATABASE_FILE ?? path.join(DATA_DIR, "hospital-ai-os.db");
const DEST_ROOT = process.argv[2] ?? process.env.BACKUP_DIR ?? path.join(process.cwd(), "backups");
const KEEP = Number(process.env.KEEP ?? 7);

if (!fs.existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}. Set DATABASE_FILE or DATA_DIR.`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dest = path.join(DEST_ROOT, stamp);
fs.mkdirSync(dest, { recursive: true });

/* ----------------------------- database ----------------------------- */
const started = Date.now();
const dbOut = path.join(dest, "hospital-ai-os.db");
{
  const db = new DatabaseSync(DB_PATH);
  /* VACUUM INTO also compacts, so the snapshot is smaller than the live file. */
  db.exec(`VACUUM INTO '${dbOut.replace(/'/g, "''")}'`);
  db.close();
}

/* Verify the snapshot opens and passes SQLite's own integrity check. A backup
   nobody has verified is a hope, not a backup. */
{
  const check = new DatabaseSync(dbOut);
  const result = check.prepare("PRAGMA integrity_check").get();
  const ok = String(Object.values(result)[0]).toLowerCase() === "ok";
  const counts = {};
  for (const t of ["organizations", "users", "patients", "admissions", "lab_orders", "charges"]) {
    try { counts[t] = check.prepare(`SELECT count(*) c FROM ${t}`).get().c; } catch { counts[t] = "—"; }
  }
  check.close();
  if (!ok) {
    console.error("Integrity check FAILED — the snapshot is not usable. Leaving it in place for inspection.");
    process.exit(2);
  }
  fs.writeFileSync(path.join(dest, "manifest.json"), JSON.stringify({
    takenAt: new Date().toISOString(),
    source: DB_PATH,
    bytes: fs.statSync(dbOut).size,
    integrity: "ok",
    rowCounts: counts,
  }, null, 2));
  console.log(`database  ✓ ${(fs.statSync(dbOut).size / 1048576).toFixed(1)} MB · integrity ok`);
  console.log(`          ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join("  ")}`);
}

/* ---------------------------- recordings ---------------------------- */
const recDir = path.join(DATA_DIR, "recordings");
if (fs.existsSync(recDir)) {
  const out = path.join(dest, "recordings.tar.gz");
  try {
    execFileSync("tar", ["-czf", out, "-C", DATA_DIR, "recordings"], { stdio: "pipe" });
    console.log(`recordings ✓ ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
  } catch (e) {
    console.error("recordings ✗ could not archive:", e.message);
  }
} else {
  console.log("recordings — none stored locally (S3 driver, or nothing recorded yet)");
}

/* ------------------------------ rotate ------------------------------ */
const generations = fs.readdirSync(DEST_ROOT)
  .filter((d) => /^\d{4}-\d{2}-\d{2}T/.test(d))
  .sort()
  .reverse();
for (const old of generations.slice(KEEP)) {
  fs.rmSync(path.join(DEST_ROOT, old), { recursive: true, force: true });
  console.log(`rotated   – removed ${old}`);
}

console.log(`\nBackup complete in ${((Date.now() - started) / 1000).toFixed(1)}s → ${dest}`);
console.log("Copy this directory off the machine. A backup on the same disk is not a backup.");
