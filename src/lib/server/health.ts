/**
 * Is this deployment actually working?
 *
 * "The process is running" is not the same question. The failure that matters
 * most here is quiet: when the disk fills, SQLite stops accepting writes, and
 * the visible symptom is a nurse recording a set of vitals that never save. A
 * process-level check sails straight past that, so this one tries a real write.
 *
 * What it deliberately does not do is describe the hospital. An unauthenticated
 * health endpoint is a favourite source of free reconnaissance — versions, table
 * names, tenant counts — so the public answer is a status and a few numbers with
 * no identity in them.
 */

import fs from "node:fs";
import path from "node:path";
import { db, DATA_DIR, get, run } from "./db";

export type HealthState = "ok" | "degraded" | "failing";

export interface HealthCheck {
  name: string;
  state: HealthState;
  /** Safe to show an unauthenticated caller: no names, no counts of people. */
  detail: string;
  ms: number;
}

/** Below this much free space, writes are close enough to failing to shout. */
const DISK_CRITICAL_MB = 200;
const DISK_WARN_MB = 1024;

function timed<T>(fn: () => T): { value: T; ms: number } {
  const t = Date.now();
  const value = fn();
  return { value, ms: Date.now() - t };
}

/** Can we read? A database that cannot answer at all is the loudest failure. */
function checkRead(): HealthCheck {
  try {
    const { ms } = timed(() => get<{ n: number }>("SELECT COUNT(*) AS n FROM organizations"));
    return { name: "database.read", state: "ok", detail: "reachable", ms };
  } catch (e) {
    return { name: "database.read", state: "failing", detail: reason(e), ms: 0 };
  }
}

/**
 * Can we write?
 *
 * This is the check that catches a full disk, a read-only mount, and a
 * corrupted WAL — none of which a read would notice. It writes and removes a
 * single row in a table of its own, so it never touches clinical data.
 */
function checkWrite(): HealthCheck {
  try {
    const { ms } = timed(() => {
      db().exec(`CREATE TABLE IF NOT EXISTS health_probe (id INTEGER PRIMARY KEY, at TEXT NOT NULL)`);
      run("INSERT INTO health_probe (id, at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at", [
        new Date().toISOString(),
      ]);
    });
    return { name: "database.write", state: "ok", detail: "writable", ms };
  } catch (e) {
    return { name: "database.write", state: "failing", detail: reason(e), ms: 0 };
  }
}

/** How much room is left where the data lives. */
function checkDisk(): HealthCheck & { freeMb?: number } {
  try {
    const { value, ms } = timed(() => fs.statfsSync(DATA_DIR));
    const freeMb = Math.floor((value.bavail * value.bsize) / 1048576);
    const state: HealthState = freeMb < DISK_CRITICAL_MB ? "failing" : freeMb < DISK_WARN_MB ? "degraded" : "ok";
    const detail =
      state === "failing"
        ? `only ${freeMb} MB free — writes will start failing`
        : state === "degraded"
          ? `${freeMb} MB free`
          : `${freeMb} MB free`;
    return { name: "disk", state, detail, ms, freeMb };
  } catch (e) {
    /* Not every filesystem supports statfs; an unknown answer is not a failure. */
    return { name: "disk", state: "ok", detail: `not measurable (${reason(e)})`, ms: 0 };
  }
}

/** Is the database file growing toward anything alarming? */
function checkDatabaseSize(): HealthCheck & { sizeMb?: number } {
  try {
    const file = process.env.DATABASE_FILE ?? path.join(DATA_DIR, "hospital-ai-os.db");
    const sizeMb = Math.round(fs.statSync(file).size / 1048576);
    return { name: "database.size", state: "ok", detail: `${sizeMb} MB`, ms: 0, sizeMb };
  } catch (e) {
    return { name: "database.size", state: "ok", detail: `unknown (${reason(e)})`, ms: 0 };
  }
}

/**
 * When was the last backup taken?
 *
 * A deployment whose last backup is a week old is one bad day from losing a
 * week of a hospital's records, and nothing else in the system would mention
 * it. Reported as degraded rather than failing: the application is serving
 * patients perfectly well, and whoever is on call needs to know the difference.
 */
function checkBackupAge(): HealthCheck & { hoursSinceBackup?: number | null } {
  const root = process.env.BACKUP_DIR ?? path.join(process.cwd(), "backups");
  try {
    if (!fs.existsSync(root)) {
      return { name: "backup", state: "degraded", detail: "no backups have been taken", ms: 0, hoursSinceBackup: null };
    }
    const generations = fs.readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}T/.test(d)).sort();
    const latest = generations[generations.length - 1];
    if (!latest) {
      return { name: "backup", state: "degraded", detail: "no backups have been taken", ms: 0, hoursSinceBackup: null };
    }
    const takenAt = fs.statSync(path.join(root, latest)).mtimeMs;
    const hours = Math.round((Date.now() - takenAt) / 3600000);
    const state: HealthState = hours > 48 ? "failing" : hours > 26 ? "degraded" : "ok";
    return { name: "backup", state, detail: `last backup ${hours}h ago`, ms: 0, hoursSinceBackup: hours };
  } catch (e) {
    return { name: "backup", state: "degraded", detail: reason(e), ms: 0, hoursSinceBackup: null };
  }
}

function reason(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  /* Never return a filesystem path or a SQL fragment to an anonymous caller. */
  if (/SQLITE_FULL|disk.*full|no space/i.test(m)) return "the disk is full";
  if (/readonly|SQLITE_READONLY/i.test(m)) return "the database is read-only";
  if (/locked|SQLITE_BUSY/i.test(m)) return "the database is locked";
  return "unavailable";
}

export interface HealthReport {
  status: HealthState;
  checks: HealthCheck[];
  uptimeSeconds: number;
  at: string;
}

export function health(): HealthReport {
  const checks: HealthCheck[] = [checkRead(), checkWrite(), checkDisk(), checkDatabaseSize(), checkBackupAge()];
  const status: HealthState = checks.some((c) => c.state === "failing")
    ? "failing"
    : checks.some((c) => c.state === "degraded")
      ? "degraded"
      : "ok";
  return { status, checks, uptimeSeconds: Math.round(process.uptime()), at: new Date().toISOString() };
}
