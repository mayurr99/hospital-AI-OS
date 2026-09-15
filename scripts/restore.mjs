#!/usr/bin/env node
/**
 * Restore a backup taken by scripts/backup.mjs.
 *
 * The backup script was the easy half. This is the half that decides whether a
 * hospital gets its records back, and it is written to be usable by a tired
 * person at three in the morning who has never run it before.
 *
 * Three things it does that a `cp` does not:
 *
 *   1. **Refuses to run against a live server.** Overwriting a SQLite file that
 *      a running process holds open produces a database that is neither the old
 *      one nor the new one. It checks the port and stops.
 *   2. **Keeps what it replaces.** The current database is moved aside, not
 *      deleted, so a restore from the wrong backup is itself recoverable. This
 *      is the mistake people actually make under pressure.
 *   3. **Verifies before and after.** The snapshot is integrity-checked and its
 *      row counts printed *before* anything is touched, so you can see what you
 *      are about to restore rather than finding out afterwards.
 *
 *   node scripts/restore.mjs backups/2026-09-14T19-10-14-773Z
 *   node scripts/restore.mjs <dir> --yes      # skip the confirmation prompt
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import readline from "node:readline/promises";
import { execFileSync } from "node:child_process";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
const DB_PATH = process.env.DATABASE_FILE ?? path.join(DATA_DIR, "hospital-ai-os.db");
const PORT = Number(process.env.PORT ?? 3000);

const args = process.argv.slice(2);
const source = args.find((a) => !a.startsWith("--"));
const assumeYes = args.includes("--yes") || args.includes("-y");

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!source) {
  const root = path.join(process.cwd(), "backups");
  const available = fs.existsSync(root)
    ? fs.readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}T/.test(d)).sort().reverse()
    : [];
  console.error("\n  Usage: node scripts/restore.mjs <backup directory> [--yes]\n");
  if (available.length) {
    console.error("  Available backups, newest first:");
    for (const d of available.slice(0, 10)) console.error(`    backups/${d}`);
    console.error("");
  }
  process.exit(1);
}

const snapshot = path.join(source, "hospital-ai-os.db");
if (!fs.existsSync(snapshot)) die(`No hospital-ai-os.db inside ${source}`);

/* ------------------------- 1. is the app running? ------------------------ */
const portBusy = await new Promise((resolve) => {
  const probe = net.createConnection({ port: PORT, host: "127.0.0.1" });
  probe.on("connect", () => { probe.destroy(); resolve(true); });
  probe.on("error", () => resolve(false));
  setTimeout(() => { probe.destroy(); resolve(false); }, 1500);
});
if (portBusy) {
  die(
    `Something is serving on port ${PORT}.\n\n` +
    `  Stop the application before restoring. Writing over a database file that a\n` +
    `  running process has open produces a file that is neither the backup nor the\n` +
    `  original, and you will not be told.\n\n` +
    `    macOS / Linux   lsof -ti:${PORT} | xargs kill\n` +
    `    then re-run this command`,
  );
}

/* --------------------- 2. inspect what we are restoring ------------------ */
const TABLES = ["organizations", "users", "patients", "admissions", "lab_orders", "lab_results", "charges"];
let snapshotCounts = {};
{
  const db = new DatabaseSync(snapshot);
  const integrity = String(Object.values(db.prepare("PRAGMA integrity_check").get())[0]).toLowerCase();
  if (integrity !== "ok") {
    db.close();
    die(`The snapshot fails SQLite's integrity check (${integrity}). Do not restore it — try an older backup.`);
  }
  for (const t of TABLES) {
    try { snapshotCounts[t] = db.prepare(`SELECT count(*) c FROM ${t}`).get().c; } catch { snapshotCounts[t] = "—"; }
  }
  db.close();
}

let currentCounts = {};
const haveCurrent = fs.existsSync(DB_PATH);
if (haveCurrent) {
  try {
    const db = new DatabaseSync(DB_PATH);
    for (const t of TABLES) {
      try { currentCounts[t] = db.prepare(`SELECT count(*) c FROM ${t}`).get().c; } catch { currentCounts[t] = "—"; }
    }
    db.close();
  } catch {
    currentCounts = Object.fromEntries(TABLES.map((t) => [t, "unreadable"]));
  }
}

const manifestPath = path.join(source, "manifest.json");
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;

console.log(`\n  Restoring from  ${source}`);
if (manifest?.takenAt) console.log(`  Taken at        ${manifest.takenAt}`);
console.log(`  Into            ${DB_PATH}\n`);
console.log(`  ${"table".padEnd(16)} ${"now".padStart(10)}  →  ${"after restore".padStart(13)}`);
console.log(`  ${"-".repeat(16)} ${"-".repeat(10)}     ${"-".repeat(13)}`);
for (const t of TABLES) {
  const now = haveCurrent ? String(currentCounts[t]) : "(no db)";
  console.log(`  ${t.padEnd(16)} ${now.padStart(10)}  →  ${String(snapshotCounts[t]).padStart(13)}`);
}

/* Loudly flag the case that actually loses data: restoring over a database that
   has MORE in it than the backup. */
const losing = TABLES.filter((t) =>
  haveCurrent && Number.isInteger(currentCounts[t]) && Number.isInteger(snapshotCounts[t]) &&
  currentCounts[t] > snapshotCounts[t]);
if (losing.length) {
  console.log(`\n  \x1b[33mWarning: the current database has MORE rows than this backup in: ${losing.join(", ")}.\x1b[0m`);
  console.log(`  Anything recorded since the backup was taken is not in it. The current file is`);
  console.log(`  kept alongside, so this is reversible — but be sure this is the backup you want.`);
}

if (!assumeYes) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("\n  Type RESTORE to continue: ");
  rl.close();
  if (answer.trim() !== "RESTORE") die("Cancelled. Nothing was changed.");
}

/* ----------------------- 3. set the current one aside -------------------- */
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
if (haveCurrent) {
  const aside = `${DB_PATH}.replaced-${stamp}`;
  fs.renameSync(DB_PATH, aside);
  /* WAL and shared-memory files belong to the database they were written for;
     leaving them behind would corrupt the restored file. */
  for (const suffix of ["-wal", "-shm"]) {
    if (fs.existsSync(DB_PATH + suffix)) fs.renameSync(DB_PATH + suffix, aside + suffix);
  }
  console.log(`\n  Previous database kept at  ${aside}`);
}

fs.copyFileSync(snapshot, DB_PATH);

/* --------------------------- 4. recordings ------------------------------- */
const recArchive = path.join(source, "recordings.tar.gz");
if (fs.existsSync(recArchive)) {
  const recDir = path.join(DATA_DIR, "recordings");
  if (fs.existsSync(recDir)) {
    fs.renameSync(recDir, `${recDir}.replaced-${stamp}`);
    console.log(`  Previous recordings kept at ${recDir}.replaced-${stamp}`);
  }
  try {
    execFileSync("tar", ["-xzf", recArchive, "-C", DATA_DIR], { stdio: "pipe" });
    console.log("  Recordings restored");
  } catch (e) {
    console.error(`  \x1b[31mRecordings could not be extracted: ${e.message}\x1b[0m`);
  }
}

/* ------------------------- 5. verify the result -------------------------- */
{
  const db = new DatabaseSync(DB_PATH);
  const integrity = String(Object.values(db.prepare("PRAGMA integrity_check").get())[0]).toLowerCase();
  const after = {};
  for (const t of TABLES) {
    try { after[t] = db.prepare(`SELECT count(*) c FROM ${t}`).get().c; } catch { after[t] = "—"; }
  }
  db.close();

  const matches = TABLES.every((t) => String(after[t]) === String(snapshotCounts[t]));
  console.log(`\n  Integrity  ${integrity === "ok" ? "\x1b[32mok\x1b[0m" : `\x1b[31m${integrity}\x1b[0m`}`);
  console.log(`  Row counts ${matches ? "\x1b[32mmatch the snapshot\x1b[0m" : "\x1b[31mDO NOT match the snapshot\x1b[0m"}`);
  if (integrity !== "ok" || !matches) {
    die("Restore did not verify. The previous database is still on disk — put it back before doing anything else.");
  }
}

console.log(`\n  Restore complete. Start the application and check that staff can sign in.\n`);
