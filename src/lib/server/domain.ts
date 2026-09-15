/**
 * Domain plumbing shared by every clinical service: transactions, per-hospital
 * counters, the clinical audit trail and the patient timeline.
 *
 * Everything here takes `orgId` as its first argument and every statement
 * filters on it. The orgId always comes from `requireOrg()`, which reads the
 * server session — it is never accepted from a request body or a query string.
 */

import { all, db, get, id, nowIso, run } from "./db";
import { HttpError, type Session } from "./auth";
import { publish, type ChangeTopic } from "./realtime";

/* ----------------------------- transactions ---------------------------- */

/**
 * Change notifications waiting for their transaction to commit.
 *
 * Telling every screen in the hospital that a bed was taken, and then rolling
 * the transaction back, is worse than not telling them at all — the ward board
 * would show an occupied bed that is actually free. So publications raised
 * inside a transaction are held here and released only on COMMIT.
 */
type PendingChange = { orgId: string; topic: ChangeTopic; action: string; meta: Record<string, string | undefined> };
let pending: PendingChange[] | null = null;

/** Announce a change, after the current transaction commits if there is one. */
export function announce(
  orgId: string,
  topic: ChangeTopic,
  action: string,
  meta: { entityId?: string; patientId?: string; actorId?: string } = {},
) {
  if (pending) pending.push({ orgId, topic, action, meta });
  else publish(orgId, topic, action, meta);
}

/**
 * Runs `fn` inside an IMMEDIATE transaction.
 *
 * IMMEDIATE (rather than DEFERRED) takes the write lock up front, so two
 * receptionists racing for the same bed serialise here instead of one of them
 * failing at COMMIT with SQLITE_BUSY after doing all the work.
 *
 * Nested calls join the outer transaction rather than starting a second one,
 * and only the outermost commit releases the queued change notifications.
 */
export function tx<T>(fn: () => T): T {
  if (pending) return fn(); /* already inside a transaction — join it */

  const conn = db();
  const queue: PendingChange[] = [];
  pending = queue;
  conn.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    conn.exec("COMMIT");
    pending = null;
    for (const c of queue) publish(c.orgId, c.topic, c.action, c.meta);
    return out;
  } catch (e) {
    pending = null;
    try {
      conn.exec("ROLLBACK");
    } catch {
      /* the transaction was already unwound */
    }
    throw e; /* the queued notifications are discarded with the work */
  }
}

/**
 * SQLite reports a unique violation by the *columns* involved, not by the index
 * name ("UNIQUE constraint failed: admissions.org_id, admissions.patient_id").
 * This maps our index names onto the column signature that identifies them, so
 * a caller can ask about the constraint it actually cares about and get a
 * precise, user-facing 409 instead of a generic 500.
 */
const UNIQUE_SIGNATURES: Record<string, string[]> = {
  patients_uhid: ["patients.uhid"],
  patients_external: ["patients.external_id"],
  admissions_one_active: ["admissions.patient_id"],
  admissions_no: ["admissions.admission_no"],
  ward_assign_one_active_bed: ["ward_assignments.bed_id"],
  ward_assign_one_active_adm: ["ward_assignments.admission_id"],
  encounters_no: ["encounters.encounter_no"],
  lab_orders_no: ["lab_orders.order_no"],
  beds_ward_number: ["beds.number"],
  lab_tests_code: ["lab_tests.code"],
};

/** True when an error is a unique-constraint violation on the named index. */
export function isUniqueViolation(e: unknown, index?: string): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  if (!/UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(msg)) return false;
  if (!index) return true;
  if (msg.includes(index)) return true;
  return (UNIQUE_SIGNATURES[index] ?? []).some((sig) => msg.includes(sig));
}

/* ------------------------------- counters ------------------------------ */

/** Monotonic per-hospital counter. Must be called inside a transaction. */
export function nextCounter(orgId: string, name: string): number {
  run(
    `INSERT INTO org_counters (org_id, name, value) VALUES (?,?,1)
     ON CONFLICT(org_id, name) DO UPDATE SET value = value + 1`,
    [orgId, name],
  );
  const row = get<{ value: number }>("SELECT value FROM org_counters WHERE org_id = ? AND name = ?", [orgId, name]);
  return row?.value ?? 1;
}

/** Seeds a counter above any number already present, so generated ids never collide. */
export function seedCounter(orgId: string, name: string, atLeast: number) {
  run(
    `INSERT INTO org_counters (org_id, name, value) VALUES (?,?,?)
     ON CONFLICT(org_id, name) DO UPDATE SET value = MAX(value, excluded.value)`,
    [orgId, name, atLeast],
  );
}

const YEAR = () => new Date().getFullYear();

export function nextUhid(orgId: string, prefix = "UH"): string {
  const n = nextCounter(orgId, "uhid");
  return `${prefix}${YEAR()}${String(n).padStart(6, "0")}`;
}

export function nextAdmissionNo(orgId: string): string {
  const n = nextCounter(orgId, "admission");
  return `IP${YEAR()}${String(n).padStart(5, "0")}`;
}

export function nextEncounterNo(orgId: string): string {
  const n = nextCounter(orgId, "encounter");
  return `EN${YEAR()}${String(n).padStart(6, "0")}`;
}

export function nextLabOrderNo(orgId: string): string {
  const n = nextCounter(orgId, "laborder");
  return `LAB${YEAR()}${String(n).padStart(5, "0")}`;
}

export function nextSampleId(orgId: string): string {
  const n = nextCounter(orgId, "sample");
  return `S${String(n).padStart(7, "0")}`;
}

/* ---------------------------- clinical audit --------------------------- */

export interface AuditContext {
  session: Session;
  orgId: string;
}

/**
 * Writes a before/after clinical audit row.
 *
 * Clinical records are amended, not destroyed, so the audit trail plus the
 * record's own status field (`AMENDED`, `ENTERED_IN_ERROR`, `CANCELLED`) is the
 * complete history of what a clinician saw and when.
 */
export function clinicalAudit(ctx: AuditContext, entry: {
  patientId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  /** The record's version after this change, when the record is versioned. */
  entityVersion?: number | null;
}) {
  run(
    `INSERT INTO clinical_audit
       (id, org_id, patient_id, actor_id, actor_name, actor_role, entity_type, entity_id, action, reason, before, after, at, entity_version)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id("caud"),
      ctx.orgId,
      entry.patientId ?? null,
      ctx.session.user.id,
      ctx.session.user.name,
      ctx.session.user.role,
      entry.entityType,
      entry.entityId,
      entry.action,
      entry.reason ?? "",
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      nowIso(),
      entry.entityVersion ?? null,
    ],
  );

  /*
   * Every clinical write goes through this function, so announcing here is what
   * makes live updates automatic: a new write cannot forget to notify the other
   * screens, because it cannot skip its own audit entry.
   */
  const topic = TOPIC_FOR_ENTITY[entry.entityType];
  if (topic) {
    announce(ctx.orgId, topic, entry.action, {
      entityId: entry.entityId,
      patientId: entry.patientId ?? undefined,
      actorId: ctx.session.user.id,
    });
  }
}

/**
 * Which live-update topic each audited entity belongs to.
 *
 * Ward assignments are published as `bed` because that is the thing watchers
 * care about: the board redraws when occupancy changes, whatever the underlying
 * row was called.
 */
const TOPIC_FOR_ENTITY: Record<string, ChangeTopic> = {
  patient: "patient",
  allergy: "patient",
  admission: "admission",
  ward_assignment: "bed",
  bed: "bed",
  lab_order: "lab",
  critical_notification: "critical",
  vitals: "vitals",
  medication_order: "medication",
  encounter: "encounter",
  diagnosis: "encounter",
  document: "encounter",
  import_batch: "patient",
};

export function listClinicalAudit(orgId: string, patientId: string, limit = 200) {
  return all<Record<string, unknown>>(
    "SELECT * FROM clinical_audit WHERE org_id = ? AND patient_id = ? ORDER BY at DESC LIMIT ?",
    [orgId, patientId, limit],
  ).map((r) => ({
    id: r.id,
    at: r.at,
    actor: r.actor_name,
    actorRole: r.actor_role,
    entityType: r.entity_type,
    entityId: r.entity_id,
    action: r.action,
    reason: r.reason,
    before: safeParse(r.before as string | null),
    after: safeParse(r.after as string | null),
  }));
}

function safeParse(v: string | null): unknown {
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/* ------------------------------- timeline ------------------------------ */

export type EventKind =
  | "registration" | "import" | "appointment" | "encounter" | "admission" | "transfer"
  | "discharge" | "vitals" | "diagnosis" | "prescription" | "lab_order" | "lab_sample"
  | "lab_result" | "lab_verified" | "lab_critical" | "document" | "call" | "escalation"
  | "allergy" | "billing" | "note";

/** Appends to the unified patient timeline. Every item links to its record. */
export function addEvent(orgId: string, e: {
  patientId: string;
  at?: string;
  kind: EventKind;
  title: string;
  detail?: string;
  entityType?: string;
  entityId?: string;
  actor?: string;
  severity?: "info" | "warning" | "critical";
}) {
  run(
    `INSERT INTO patient_events (id, org_id, patient_id, at, kind, title, detail, entity_type, entity_id, actor, severity, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id("evt"), orgId, e.patientId, e.at ?? nowIso(), e.kind, e.title,
      e.detail ?? "", e.entityType ?? "", e.entityId ?? "", e.actor ?? "", e.severity ?? "info", nowIso(),
    ],
  );
}

export function listEvents(orgId: string, patientId: string, limit = 300) {
  return all<Record<string, unknown>>(
    "SELECT * FROM patient_events WHERE org_id = ? AND patient_id = ? ORDER BY at DESC, rowid DESC LIMIT ?",
    [orgId, patientId, limit],
  ).map((r) => ({
    id: r.id as string,
    at: r.at as string,
    kind: r.kind as EventKind,
    title: r.title as string,
    detail: r.detail as string,
    entityType: r.entity_type as string,
    entityId: r.entity_id as string,
    actor: r.actor as string,
    severity: r.severity as string,
  }));
}

/* ------------------------------ tenant guard --------------------------- */

/**
 * Loads a row by id *within the tenant*, or throws 404.
 *
 * Every clinical route resolves ids through this, so an id belonging to another
 * hospital is indistinguishable from one that does not exist — which is what
 * closes the IDOR class of bug rather than just hiding it.
 */
export function requireRow<T = Record<string, unknown>>(
  orgId: string, table: string, rowId: string, label = "Record",
): T {
  if (!/^[a-z_]+$/.test(table)) throw new HttpError(400, "Bad table");
  const row = get<T>(`SELECT * FROM ${table} WHERE org_id = ? AND id = ?`, [orgId, rowId]);
  if (!row) throw new HttpError(404, `${label} not found in this hospital`);
  return row;
}

export function rowExists(orgId: string, table: string, rowId: string): boolean {
  if (!/^[a-z_]+$/.test(table)) return false;
  return Boolean(get(`SELECT 1 AS x FROM ${table} WHERE org_id = ? AND id = ?`, [orgId, rowId]));
}
