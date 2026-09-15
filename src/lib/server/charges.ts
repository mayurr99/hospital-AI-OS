/**
 * Charges raised by clinical events.
 *
 * Billing in most hospital software is a parallel universe: somebody reads the
 * chart and re-types what happened into an invoice. Every step of that is a
 * chance to bill for a test that was cancelled, miss a bed-day, or charge the
 * wrong patient — and the bill then disagrees with the record it came from, with
 * no way to tell which is right.
 *
 * So charges here are *derived*, not entered. Releasing a lab report raises its
 * charge; occupying a bed accrues a bed-day at that bed's rate. Each charge
 * carries the id of the clinical record that caused it, which means:
 *
 *   - the bill can always be traced back to the event that justifies it;
 *   - the same event can never be billed twice, because the source id is unique;
 *   - a cancelled order simply never raises one.
 *
 * Nothing here decides prices or applies a tariff. It records what was done, at
 * the rate configured for that item, and leaves discounts, payer rules and
 * adjudication to the billing screen — those are commercial decisions, not
 * clinical facts.
 */

import { all, get, id, nowIso, run } from "./db";
import { announce } from "./domain";

export interface Charge {
  id: string;
  orgId: string;
  patientId: string;
  admissionId: string | null;
  /** What caused this charge: "lab_order" | "bed_day". */
  sourceType: string;
  /** The clinical record's id. Unique per source type — this is the double-bill guard. */
  sourceId: string;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  occurredAt: string;
  status: string;
  createdAt: string;
}

export function migrateCharges(conn: { exec: (sql: string) => void }) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS charges (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      patient_id    TEXT NOT NULL,
      admission_id  TEXT,
      source_type   TEXT NOT NULL,
      source_id     TEXT NOT NULL,
      description   TEXT NOT NULL,
      quantity      REAL NOT NULL DEFAULT 1,
      unit_amount   REAL NOT NULL DEFAULT 0,
      amount        REAL NOT NULL DEFAULT 0,
      occurred_at   TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'UNBILLED',
      invoice_id    TEXT,
      created_by    TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL,
      CHECK (status IN ('UNBILLED','INVOICED','CANCELLED'))
    );
    /* The same clinical event can only ever produce one charge. */
    CREATE UNIQUE INDEX IF NOT EXISTS charges_source
      ON charges (org_id, source_type, source_id);
    CREATE INDEX IF NOT EXISTS charges_patient ON charges (org_id, patient_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS charges_admission ON charges (org_id, admission_id);
  `);
}

/**
 * Record a charge for a clinical event, once.
 *
 * Idempotent by (source type, source id): calling it again for the same event
 * updates the description and amount rather than adding a second line. That
 * matters because a lab report can be amended and re-released, and an amended
 * report must not double the bill.
 */
export function raiseCharge(input: {
  orgId: string;
  patientId: string;
  admissionId?: string | null;
  sourceType: string;
  sourceId: string;
  description: string;
  quantity?: number;
  unitAmount: number;
  occurredAt?: string;
  actorId?: string;
}): Charge | null {
  const qty = input.quantity ?? 1;
  const amount = Math.round(qty * input.unitAmount * 100) / 100;
  const at = input.occurredAt ?? nowIso();

  const existing = get<{ id: string; status: string }>(
    "SELECT id, status FROM charges WHERE org_id = ? AND source_type = ? AND source_id = ?",
    [input.orgId, input.sourceType, input.sourceId],
  );

  if (existing) {
    /* Never silently rewrite a charge that has already been put on an invoice —
       that would change a bill the patient may already have been given. */
    if (existing.status !== "UNBILLED") return null;
    run(
      `UPDATE charges SET description = ?, quantity = ?, unit_amount = ?, amount = ?, occurred_at = ?
        WHERE org_id = ? AND id = ?`,
      [input.description, qty, input.unitAmount, amount, at, input.orgId, existing.id],
    );
  } else {
    run(
      `INSERT INTO charges
         (id, org_id, patient_id, admission_id, source_type, source_id, description,
          quantity, unit_amount, amount, occurred_at, status, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, 'UNBILLED', ?,?)`,
      [
        id("chg"), input.orgId, input.patientId, input.admissionId ?? null,
        input.sourceType, input.sourceId, input.description,
        qty, input.unitAmount, amount, at, input.actorId ?? "", nowIso(),
      ],
    );
  }

  announce(input.orgId, "billing", "charge.raised", {
    patientId: input.patientId,
    entityId: input.sourceId,
    actorId: input.actorId,
  });

  return listCharges(input.orgId, { patientId: input.patientId }).find(
    (c) => c.sourceType === input.sourceType && c.sourceId === input.sourceId,
  ) ?? null;
}

/** Withdraw a charge whose clinical event was cancelled. */
export function cancelCharge(orgId: string, sourceType: string, sourceId: string) {
  run(
    "UPDATE charges SET status = 'CANCELLED' WHERE org_id = ? AND source_type = ? AND source_id = ? AND status = 'UNBILLED'",
    [orgId, sourceType, sourceId],
  );
}

function toCharge(r: Record<string, unknown>): Charge {
  return {
    id: r.id as string, orgId: r.org_id as string, patientId: r.patient_id as string,
    admissionId: (r.admission_id as string) ?? null,
    sourceType: r.source_type as string, sourceId: r.source_id as string,
    description: r.description as string,
    quantity: r.quantity as number, unitAmount: r.unit_amount as number, amount: r.amount as number,
    occurredAt: r.occurred_at as string, status: r.status as string, createdAt: r.created_at as string,
  };
}

export function listCharges(
  orgId: string, opts: { patientId?: string; admissionId?: string; status?: string; limit?: number } = {},
): Charge[] {
  const where = ["org_id = ?"];
  const params: (string | number)[] = [orgId];
  if (opts.patientId) { where.push("patient_id = ?"); params.push(opts.patientId); }
  if (opts.admissionId) { where.push("admission_id = ?"); params.push(opts.admissionId); }
  if (opts.status) { where.push("status = ?"); params.push(opts.status); }
  params.push(Math.min(opts.limit ?? 300, 1000));
  return all<Record<string, unknown>>(
    `SELECT * FROM charges WHERE ${where.join(" AND ")} ORDER BY occurred_at DESC LIMIT ?`, params,
  ).map(toCharge);
}

/**
 * Bed charges for a stay, one line per calendar day occupied.
 *
 * Recomputed from the ward assignments rather than incremented by a timer, so it
 * is correct however the stay went — transfers between beds at different rates,
 * a discharge backdated by a clerk, a server that was switched off overnight.
 * A day is charged to whichever bed the patient was in at the start of it.
 */
export function accrueBedDays(orgId: string, admissionId: string, actorId = ""): number {
  const assignments = all<{
    id: string; bed_id: string; from_at: string; to_at: string | null;
    number: string; ward_name: string; daily_rate: number; patient_id: string;
  }>(
    `SELECT wa.id, wa.bed_id, wa.from_at, wa.to_at, b.number, b.daily_rate, w.name AS ward_name, wa.patient_id
       FROM ward_assignments wa
       JOIN beds b  ON b.org_id = wa.org_id AND b.id = wa.bed_id
       JOIN wards w ON w.org_id = b.org_id  AND w.id = b.ward_id
      WHERE wa.org_id = ? AND wa.admission_id = ?
      ORDER BY wa.from_at`,
    [orgId, admissionId],
  );
  if (!assignments.length) return 0;

  let raised = 0;
  for (const a of assignments) {
    const start = new Date(a.from_at);
    const end = a.to_at ? new Date(a.to_at) : new Date();
    if (!Number.isFinite(start.getTime())) continue;

    /* Walk calendar days, charging the day the occupancy began and each
       subsequent day the patient was still in that bed at midnight. */
    const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

    /* A stay that starts and ends the same day is one bed-day, not zero. */
    while (day <= lastDay) {
      const dateKey = day.toISOString().slice(0, 10);
      raiseCharge({
        orgId,
        patientId: a.patient_id,
        admissionId,
        sourceType: "bed_day",
        sourceId: `${a.id}:${dateKey}`,
        description: `Bed charge — ${a.ward_name} bed ${a.number} (${dateKey})`,
        unitAmount: a.daily_rate ?? 0,
        occurredAt: `${dateKey}T00:00:00.000Z`,
        actorId,
      });
      raised += 1;
      day.setUTCDate(day.getUTCDate() + 1);
      /* Guard against a clock or data error producing an unbounded loop. */
      if (raised > 400) break;
    }
  }
  return raised;
}
