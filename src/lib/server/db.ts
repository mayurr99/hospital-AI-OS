import type { DatabaseSync } from "node:sqlite";
import { migrateClinical } from "./schema";
import { migrateCharges } from "./charges";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

/**
 * Data layer.
 *
 * Uses Node's built-in SQLite driver, so the product runs with zero external
 * services. Every query in the application goes through this module, which is
 * what keeps the Postgres migration path a contained change: implement the same
 * `all / get / run` surface against `pg` and point `DB_DRIVER` at it.
 *
 * Storage model:
 *  - Control-plane tables (organizations, users, sessions, subscriptions,
 *    settings, recordings, exports, audit) are normalised columns.
 *  - Clinical and operational entities live in one `records` table keyed by
 *    (org_id, kind) with a JSON payload. They are read and written as whole
 *    documents by the application, and this keeps tenant scoping impossible to
 *    forget: there is exactly one place that reads them.
 */

export const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
const DB_PATH = process.env.DATABASE_FILE ?? path.join(DATA_DIR, "hospital-ai-os.db");

let _db: DatabaseSync | null = null;

/**
 * `node:sqlite` only exists from Node 22.5. It is loaded lazily rather than as a
 * top-level import so that an unsupported Node version produces a readable API
 * error instead of a module-load failure (which Next answers with an HTML error
 * page, and the browser then reports as "Unexpected token '<'").
 */
function sqlite(): { DatabaseSync: new (p: string) => DatabaseSync } {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const supported = major > 22 || (major === 22 && minor >= 5);
  if (!supported) {
    throw new Error(
      `Hospital AI OS needs Node 22.5 or newer — you are running Node ${process.versions.node}, ` +
        `which has no built-in SQLite (node:sqlite). Install Node 22 LTS (nvm install 22 && nvm use 22), ` +
        `delete node_modules and .next, then run npm install and npm run dev again.`,
    );
  }
  try {
    return createRequire(import.meta.url)("node:sqlite");
  } catch {
    throw new Error(
      `This Node build does not expose node:sqlite. Run with Node 22.5+ (node --version), or start it with ` +
        `--experimental-sqlite.`,
    );
  }
}

/**
 * Thrown when the data directory cannot be written to.
 *
 * This is the failure mode of deploying to a serverless host — Netlify, Vercel,
 * Lambda — where the filesystem is read-only apart from /tmp and every request
 * may land in a different container. The application stores everything in a
 * SQLite file, so the first write fails and the raw driver message,
 * `attempt to write a readonly database`, surfaces wherever it happens to be —
 * which, because signing in creates a session row, is the public login screen.
 *
 * A database error on a login page is useless to the person reading it and
 * tells a stranger more about the stack than they need. This carries a sentence
 * somebody can act on instead, and `route.ts` turns it into a 503.
 */
export class StorageUnwritableError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(
      "This deployment cannot write to its database. Hospital AI OS keeps its data in a SQLite " +
        "file and needs a writable, persistent disk — it cannot run on a serverless host " +
        "(Netlify, Vercel, Lambda), where the filesystem is read-only and each request may run " +
        "in a different container. See DEPLOYMENT.md.",
    );
    this.name = "StorageUnwritableError";
    this.detail = detail;
  }
}

export function db(): DatabaseSync {
  if (_db) return _db;
  const { DatabaseSync } = sqlite();
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  } catch (e) {
    throw new StorageUnwritableError(`cannot create ${path.dirname(DB_PATH)}: ${(e as Error).message}`);
  }
  /*
   * Opening can fail before anything is written.
   *
   * WAL mode needs to create `-wal` and `-shm` files beside the database, so on
   * a read-only directory the constructor itself throws `unable to open
   * database file` — earlier than the write probe below, and with a message
   * that says nothing about the real cause. Both paths end up as the same
   * explanation.
   */
  let conn: DatabaseSync;
  try {
    conn = new DatabaseSync(DB_PATH);
    conn.exec("PRAGMA journal_mode = WAL");
  } catch (e) {
    throw new StorageUnwritableError(`${DB_PATH}: ${(e as Error).message}`);
  }
  conn.exec("PRAGMA foreign_keys = ON");
  /*
   * Behaviour under load.
   *
   * WAL lets readers run while one writer holds the write lock, but a second
   * writer arriving mid-transaction fails *immediately* with SQLITE_BUSY unless
   * told to wait. That is exactly the shape of a busy ward round: two nurses
   * saving vitals in the same second, one of them seeing "database is locked".
   * Five seconds of patience turns that error into a few milliseconds of wait.
   */
  conn.exec("PRAGMA busy_timeout = 5000");
  /* WAL already survives process crashes; full fsync per commit only protects
   * against OS-level power loss and costs an order of magnitude on writes. */
  conn.exec("PRAGMA synchronous = NORMAL");
  conn.exec("PRAGMA cache_size = -32000");   /* 32 MB page cache, not 2 MB */
  conn.exec("PRAGMA temp_store = MEMORY");
  conn.exec("PRAGMA mmap_size = 268435456"); /* 256 MB mapped reads */

  /*
   * Prove the file is writable before anything else runs.
   *
   * Opening a SQLite database on a read-only filesystem succeeds — the failure
   * arrives later, at the first INSERT, which is usually somebody's sign-in.
   * Finding out here means one clear message at startup instead of a raw driver
   * error on whatever screen happened to write first.
   */
  try {
    conn.exec("CREATE TABLE IF NOT EXISTS storage_probe (id INTEGER PRIMARY KEY)");
    conn.exec("DELETE FROM storage_probe");
  } catch (e) {
    const message = (e as Error).message ?? "";
    conn.close();
    throw new StorageUnwritableError(`${DB_PATH}: ${message}`);
  }

  migrate(conn);
  _db = conn;
  return conn;
}

function migrate(conn: DatabaseSync) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      short_name    TEXT NOT NULL,
      slug          TEXT NOT NULL UNIQUE,
      city          TEXT NOT NULL DEFAULT '',
      state         TEXT NOT NULL DEFAULT '',
      timezone      TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      accent_color  TEXT NOT NULL DEFAULT '#0d9488',
      logo_initials TEXT NOT NULL DEFAULT 'H',
      status        TEXT NOT NULL DEFAULT 'trial',
      plan          TEXT NOT NULL DEFAULT 'care',
      deployment    TEXT NOT NULL DEFAULT 'shared_saas',
      is_demo       INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id             TEXT PRIMARY KEY,
      org_id         TEXT,
      facility_id    TEXT,
      department_id  TEXT,
      provider_id    TEXT,
      name           TEXT NOT NULL,
      email          TEXT NOT NULL,
      phone          TEXT NOT NULL DEFAULT '',
      role           TEXT NOT NULL,
      password_hash  TEXT,
      extra_perms    TEXT NOT NULL DEFAULT '[]',
      revoked_perms  TEXT NOT NULL DEFAULT '[]',
      status         TEXT NOT NULL DEFAULT 'active',
      mfa_enabled    INTEGER NOT NULL DEFAULT 0,
      last_login     TEXT,
      created_at     TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_org ON users (email, IFNULL(org_id, ''));

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      org_id     TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ip         TEXT NOT NULL DEFAULT ''
    );

    /*
     * A sign-in that has passed the password and is waiting on the second
     * factor. Deliberately NOT a session: it carries no cookie and grants no
     * access to anything. If it expires or runs out of attempts the sign-in
     * simply fails, and the holder is no closer to the patient register than
     * someone who never typed a password at all.
     */
    CREATE TABLE IF NOT EXISTS mfa_challenges (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      org_id     TEXT,
      purpose    TEXT NOT NULL DEFAULT 'verify',
      attempts   INTEGER NOT NULL DEFAULT 0,
      ip         TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    /*
     * Password reset tokens, stored only as hashes. The raw token exists in the
     * link and nowhere else, so a copy of this table does not let anyone take
     * over an account — the same reason password_hash exists rather than a
     * password column.
     */
    CREATE TABLE IF NOT EXISTS password_resets (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      org_id       TEXT,
      token_hash   TEXT NOT NULL,
      requested_by TEXT NOT NULL DEFAULT 'self',
      created_at   TEXT NOT NULL,
      expires_at   TEXT NOT NULL,
      used_at      TEXT
    );
    CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets (user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS subscriptions (
      org_id             TEXT PRIMARY KEY,
      plan               TEXT NOT NULL DEFAULT 'trial',
      status             TEXT NOT NULL DEFAULT 'trialing',
      trial_started_at   TEXT,
      trial_ends_at      TEXT,
      seats              INTEGER NOT NULL DEFAULT 10,
      voice_minutes_cap  INTEGER NOT NULL DEFAULT 500,
      voice_minutes_used INTEGER NOT NULL DEFAULT 0,
      monthly_fee        INTEGER NOT NULL DEFAULT 0,
      features           TEXT NOT NULL DEFAULT '[]',
      updated_at         TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS onboarding (
      org_id     TEXT PRIMARY KEY,
      step       INTEGER NOT NULL DEFAULT 0,
      completed  INTEGER NOT NULL DEFAULT 0,
      answers    TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS org_settings (
      org_id     TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (org_id, key)
    );

    CREATE TABLE IF NOT EXISTS records (
      id         TEXT NOT NULL,
      org_id     TEXT NOT NULL,
      kind       TEXT NOT NULL,
      data       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (org_id, kind, id)
    );
    CREATE INDEX IF NOT EXISTS records_org_kind ON records (org_id, kind);

    CREATE TABLE IF NOT EXISTS recordings (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      call_id       TEXT NOT NULL,
      patient_id    TEXT,
      storage_kind  TEXT NOT NULL,
      storage_key   TEXT NOT NULL,
      bytes         INTEGER NOT NULL DEFAULT 0,
      duration_secs INTEGER NOT NULL DEFAULT 0,
      mime          TEXT NOT NULL DEFAULT 'audio/wav',
      transcript    TEXT NOT NULL DEFAULT '[]',
      consent       INTEGER NOT NULL DEFAULT 1,
      retention_until TEXT,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS recordings_org ON recordings (org_id, created_at DESC);

    /* Providers retry webhooks and may send several terminal events for one
       call. Claiming the provider call id before writing the chart prevents a
       retry from creating a second clinical record or billing minutes twice. */
    CREATE TABLE IF NOT EXISTS provider_events (
      provider     TEXT NOT NULL,
      org_id       TEXT NOT NULL,
      event_key    TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      PRIMARY KEY (provider, org_id, event_key)
    );
    CREATE INDEX IF NOT EXISTS provider_events_at ON provider_events (processed_at);

    CREATE TABLE IF NOT EXISTS export_jobs (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      requested_by  TEXT NOT NULL,
      template      TEXT NOT NULL,
      scope         TEXT NOT NULL DEFAULT '{}',
      status        TEXT NOT NULL DEFAULT 'queued',
      rows          INTEGER NOT NULL DEFAULT 0,
      bytes         INTEGER NOT NULL DEFAULT 0,
      storage_key   TEXT,
      download_token TEXT,
      expires_at    TEXT,
      downloaded_at TEXT,
      created_at    TEXT NOT NULL,
      completed_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS export_jobs_org ON export_jobs (org_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id         TEXT PRIMARY KEY,
      org_id     TEXT,
      actor      TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action     TEXT NOT NULL,
      target     TEXT NOT NULL DEFAULT '',
      severity   TEXT NOT NULL DEFAULT 'info',
      ip         TEXT NOT NULL DEFAULT '',
      at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_org ON audit_logs (org_id, at DESC);
  `);

  /*
   * Columns added after the first release.
   *
   * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, so
   * a hospital upgrading an existing database would otherwise start up and fail
   * on the first query mentioning a new column. Adding them explicitly, guarded
   * by what is actually in the file, is what makes an upgrade a non-event.
   */
  addColumn(conn, "users", "mfa_secret", "TEXT");
  addColumn(conn, "users", "mfa_confirmed_at", "TEXT");
  addColumn(conn, "users", "mfa_backup_codes", "TEXT NOT NULL DEFAULT '[]'");
  addColumn(conn, "users", "mfa_last_step", "INTEGER NOT NULL DEFAULT 0");

  // The relational clinical core lives in its own module.
  migrateClinical(conn);
  migrateCharges(conn);
}

/** Add a column only if the table does not already have it. */
function addColumn(conn: DatabaseSync, table: string, column: string, ddl: string) {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

type Param = string | number | null;

export function all<T = Record<string, unknown>>(sql: string, params: Param[] = []): T[] {
  return db().prepare(sql).all(...params) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, params: Param[] = []): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, params: Param[] = []) {
  return db().prepare(sql).run(...params);
}

export function nowIso() {
  return new Date().toISOString();
}

export function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

/* ------------------------- record repository ---------------------- */

export interface RecordRow<T = Record<string, unknown>> {
  id: string;
  orgId: string;
  kind: string;
  data: T;
  createdAt: string;
  updatedAt: string;
}

type RawRecord = { id: string; org_id: string; kind: string; data: string; created_at: string; updated_at: string };

function hydrate<T>(r: RawRecord): T {
  return { ...(JSON.parse(r.data) as T), id: r.id, orgId: r.org_id };
}

export const records = {
  list<T>(orgId: string, kind: string): T[] {
    return all<RawRecord>("SELECT * FROM records WHERE org_id = ? AND kind = ?", [orgId, kind]).map((r) => hydrate<T>(r));
  },
  get<T>(orgId: string, kind: string, recordId: string): T | null {
    const r = get<RawRecord>("SELECT * FROM records WHERE org_id = ? AND kind = ? AND id = ?", [orgId, kind, recordId]);
    return r ? hydrate<T>(r) : null;
  },
  put<T extends { id: string }>(orgId: string, kind: string, value: T): T {
    const ts = nowIso();
    const { id: _id, ...rest } = value as T & Record<string, unknown>;
    void _id;
    run(
      `INSERT INTO records (id, org_id, kind, data, created_at, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(org_id, kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      [value.id, orgId, kind, JSON.stringify(rest), ts, ts],
    );
    return value;
  },
  putMany<T extends { id: string }>(orgId: string, kind: string, values: T[]) {
    const ts = nowIso();
    const stmt = db().prepare(
      `INSERT INTO records (id, org_id, kind, data, created_at, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(org_id, kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    );
    for (const v of values) {
      const { id: _id, ...rest } = v as T & Record<string, unknown>;
      void _id;
      stmt.run(v.id, orgId, kind, JSON.stringify(rest), ts, ts);
    }
  },
  patch<T extends { id: string }>(orgId: string, kind: string, recordId: string, patch: Partial<T>): T | null {
    const current = records.get<T>(orgId, kind, recordId);
    if (!current) return null;
    const next = { ...current, ...patch, id: recordId } as T;
    records.put(orgId, kind, next);
    return next;
  },
  remove(orgId: string, kind: string, recordId: string) {
    run("DELETE FROM records WHERE org_id = ? AND kind = ? AND id = ?", [orgId, kind, recordId]);
  },
  count(orgId: string, kind: string): number {
    const r = get<{ n: number }>("SELECT COUNT(*) AS n FROM records WHERE org_id = ? AND kind = ?", [orgId, kind]);
    return r?.n ?? 0;
  },
};

/* ------------------------------ settings -------------------------- */

export const settings = {
  get<T>(orgId: string, key: string, fallback: T): T {
    const r = get<{ value: string }>("SELECT value FROM org_settings WHERE org_id = ? AND key = ?", [orgId, key]);
    if (!r) return fallback;
    try {
      return JSON.parse(r.value) as T;
    } catch {
      return fallback;
    }
  },
  set(orgId: string, key: string, value: unknown) {
    run(
      `INSERT INTO org_settings (org_id, key, value, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(org_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [orgId, key, JSON.stringify(value), nowIso()],
    );
  },
  all(orgId: string): Record<string, unknown> {
    const rows = all<{ key: string; value: string }>("SELECT key, value FROM org_settings WHERE org_id = ?", [orgId]);
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        out[r.key] = JSON.parse(r.value);
      } catch {
        out[r.key] = null;
      }
    }
    return out;
  },
};

/* ------------------------------- audit ---------------------------- */

export function writeAudit(entry: {
  orgId: string | null;
  actor: string;
  actorRole: string;
  action: string;
  target?: string;
  severity?: "info" | "warning" | "critical";
  ip?: string;
}) {
  run(
    "INSERT INTO audit_logs (id, org_id, actor, actor_role, action, target, severity, ip, at) VALUES (?,?,?,?,?,?,?,?,?)",
    [
      id("aud"),
      entry.orgId,
      entry.actor,
      entry.actorRole,
      entry.action,
      entry.target ?? "",
      entry.severity ?? "info",
      entry.ip ?? "",
      nowIso(),
    ],
  );
}
