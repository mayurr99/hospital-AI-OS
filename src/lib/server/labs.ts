/**
 * Laboratory service.
 *
 * A lab order is a workflow, not a document:
 *
 *   ORDERED → SAMPLE_COLLECTED → PROCESSING → RESULT_ENTERED → VERIFIED → RELEASED
 *
 * Results are structured per analyte with machine-readable reference ranges and
 * flags, so "high" is a stored value rather than a colour in the UI. A verified
 * result cannot be casually edited: changing it creates an AMENDED version and
 * keeps the previous one.
 */

import { all, get, id, nowIso, run } from "./db";
import { HttpError } from "./auth";
import {
  addEvent, clinicalAudit, nextLabOrderNo, nextSampleId, requireRow, tx, type AuditContext,
} from "./domain";
import { requireTransition, str, num, LAB_STATUSES } from "./validate";
import {
  pickRange, flagForRange, isCriticalFlag, checkPlausible, checkDelta, computeDerived,
  type Sex, type RangeDef, type AnalyteRules, type PatientContext,
} from "./labmath";
import { getPatient } from "./patients";
import { raiseCharge, cancelCharge } from "./charges";

export type LabStatus = (typeof LAB_STATUSES)[number];
export type ResultFlag = "NORMAL" | "LOW" | "HIGH" | "CRITICAL_LOW" | "CRITICAL_HIGH" | "ABNORMAL";

/** The workflow. A step cannot be skipped, and nothing moves backwards. */
export const LAB_TRANSITIONS: Record<LabStatus, LabStatus[]> = {
  ORDERED: ["SAMPLE_COLLECTED", "CANCELLED"],
  SAMPLE_COLLECTED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["RESULT_ENTERED", "CANCELLED"],
  RESULT_ENTERED: ["VERIFIED", "PROCESSING", "CANCELLED"],
  VERIFIED: ["RELEASED"],
  RELEASED: [],
  CANCELLED: [],
};

/* ------------------------------- catalog ------------------------------- */

export interface AnalyteDef {
  id: string; code: string; name: string; unit: string;
  refLow: number | null; refHigh: number | null;
  criticalLow: number | null; criticalHigh: number | null;
  refText: string; sort: number;
  /* Which patients this band applies to — see `labmath.pickRange`. */
  appliesSex: Sex; ageMinYears: number | null; ageMaxYears: number | null;
  plausibleLow: number | null; plausibleHigh: number | null;
  deltaAbs: number | null; deltaPct: number | null;
  decimals: number;
}

export interface TestDef {
  id: string; code: string; name: string; category: string; specimen: string;
  tatHours: number; active: boolean; analytes: AnalyteDef[];
}

export function listTests(orgId: string, includeInactive = false): TestDef[] {
  const tests = all<Record<string, unknown>>(
    `SELECT * FROM lab_tests WHERE org_id = ? ${includeInactive ? "" : "AND active = 1"} ORDER BY category, name`,
    [orgId],
  );
  const analytes = all<Record<string, unknown>>(
    "SELECT * FROM lab_analytes WHERE org_id = ? ORDER BY sort, name", [orgId],
  );
  const byTest = new Map<string, AnalyteDef[]>();
  for (const a of analytes) {
    const list = byTest.get(a.test_id as string) ?? [];
    list.push({
      id: a.id as string, code: a.code as string, name: a.name as string, unit: a.unit as string,
      refLow: a.ref_low as number | null, refHigh: a.ref_high as number | null,
      criticalLow: a.critical_low as number | null, criticalHigh: a.critical_high as number | null,
      refText: a.ref_text as string, sort: a.sort as number,
      appliesSex: ((a.applies_sex as string) || "any") as Sex,
      ageMinYears: (a.age_min_years as number | null) ?? null,
      ageMaxYears: (a.age_max_years as number | null) ?? null,
      plausibleLow: (a.plausible_low as number | null) ?? null,
      plausibleHigh: (a.plausible_high as number | null) ?? null,
      deltaAbs: (a.delta_abs as number | null) ?? null,
      deltaPct: (a.delta_pct as number | null) ?? null,
      decimals: (a.decimals as number | null) ?? 2,
    });
    byTest.set(a.test_id as string, list);
  }
  return tests.map((t) => ({
    id: t.id as string, code: t.code as string, name: t.name as string,
    category: t.category as string, specimen: t.specimen as string,
    tatHours: t.tat_hours as number, active: Boolean(t.active),
    analytes: byTest.get(t.id as string) ?? [],
  }));
}

/* ------------------------------- results ------------------------------- */

/**
 * Derives the machine-readable flag from the value and the analyte's ranges.
 * Critical thresholds take priority over the ordinary reference band.
 */
export function flagFor(value: number | null, a: {
  refLow: number | null; refHigh: number | null; criticalLow: number | null; criticalHigh: number | null;
}): ResultFlag {
  if (value === null) return "NORMAL";
  if (a.criticalLow !== null && value <= a.criticalLow) return "CRITICAL_LOW";
  if (a.criticalHigh !== null && value >= a.criticalHigh) return "CRITICAL_HIGH";
  if (a.refLow !== null && value < a.refLow) return "LOW";
  if (a.refHigh !== null && value > a.refHigh) return "HIGH";
  return "NORMAL";
}

export function isCritical(flag: ResultFlag): boolean {
  return flag === "CRITICAL_LOW" || flag === "CRITICAL_HIGH";
}

export interface LabResultDto {
  id: string; orderId: string; itemId: string; analyteCode: string; analyteName: string;
  value: string; valueNum: number | null; unit: string;
  refLow: number | null; refHigh: number | null; refText: string;
  flag: ResultFlag; status: string; version: number;
  enteredBy: string; enteredAt: string | null; verifiedBy: string; verifiedAt: string | null;
  /** True when the platform calculated this rather than a person entering it. */
  computed: boolean;
  /** Why this result was queried against the patient's own history, if it was. */
  deltaNote: string;
}

export interface LabOrderDto {
  id: string; orgId: string; patientId: string; patientName?: string; uhid?: string;
  encounterId: string | null; admissionId: string | null;
  orderNo: string; status: LabStatus; priority: string; clinicalNote: string;
  orderedBy: string; orderedAt: string;
  specimen: string; sampleId: string | null;
  collectedBy: string | null; collectedAt: string | null;
  processingStartedAt: string | null;
  enteredBy: string | null; enteredAt: string | null;
  verifiedBy: string | null; verifiedAt: string | null;
  releasedAt: string | null;
  cancelledBy: string | null; cancelledAt: string | null; cancelReason: string | null;
  critical: boolean;
  tests: { id: string; testId: string | null; code: string; name: string }[];
  results: LabResultDto[];
  createdAt: string; updatedAt: string;
}

function resultDto(r: Record<string, unknown>): LabResultDto {
  return {
    id: r.id as string, orderId: r.order_id as string, itemId: r.item_id as string,
    analyteCode: r.analyte_code as string, analyteName: r.analyte_name as string,
    value: r.value_text as string, valueNum: r.value_num as number | null, unit: r.unit as string,
    refLow: r.ref_low as number | null, refHigh: r.ref_high as number | null, refText: r.ref_text as string,
    flag: r.flag as ResultFlag, status: r.status as string, version: r.version as number,
    enteredBy: r.entered_by as string, enteredAt: (r.entered_at as string) ?? null,
    verifiedBy: r.verified_by as string, verifiedAt: (r.verified_at as string) ?? null,
    computed: Boolean(r.computed),
    deltaNote: (r.delta_note as string) ?? "",
  };
}

type OrderChildren = {
  items: { id: string; testId: string | null; code: string; name: string }[];
  results: ReturnType<typeof resultDto>[];
};

/**
 * Fetch the items and results for many orders in two queries instead of two per
 * order. Listing 400 orders used to cost 801 round trips to SQLite; it now costs
 * three. Callers that already hold a batch pass it in; `orderDto` falls back to
 * single-order queries so the by-id path stays unchanged.
 */
function childrenFor(orgId: string, orderIds: string[]): Map<string, OrderChildren> {
  const byOrder = new Map<string, OrderChildren>();
  for (const id of orderIds) byOrder.set(id, { items: [], results: [] });
  if (!orderIds.length) return byOrder;

  /* SQLite's default parameter ceiling is 999, so chunk generously below it. */
  for (let i = 0; i < orderIds.length; i += 400) {
    const chunk = orderIds.slice(i, i + 400);
    const holes = chunk.map(() => "?").join(",");

    for (const it of all<Record<string, unknown>>(
      `SELECT * FROM lab_order_items WHERE org_id = ? AND order_id IN (${holes}) ORDER BY created_at`,
      [orgId, ...chunk],
    )) {
      byOrder.get(it.order_id as string)?.items.push({
        id: it.id as string, testId: (it.test_id as string) ?? null,
        code: it.test_code as string, name: it.test_name as string,
      });
    }

    for (const rs of all<Record<string, unknown>>(
      `SELECT * FROM lab_results WHERE org_id = ? AND order_id IN (${holes})
         AND status <> 'ENTERED_IN_ERROR' ORDER BY created_at`,
      [orgId, ...chunk],
    )) {
      byOrder.get(rs.order_id as string)?.results.push(resultDto(rs));
    }
  }
  return byOrder;
}

function orderDto(r: Record<string, unknown>, orgId: string, batch?: Map<string, OrderChildren>): LabOrderDto {
  const pre = batch?.get(r.id as string);
  const items = pre
    ? pre.items
    : all<Record<string, unknown>>(
        "SELECT * FROM lab_order_items WHERE org_id = ? AND order_id = ? ORDER BY created_at", [orgId, r.id as string],
      ).map((i) => ({
        id: i.id as string, testId: (i.test_id as string) ?? null,
        code: i.test_code as string, name: i.test_name as string,
      }));
  const results = pre
    ? pre.results
    : all<Record<string, unknown>>(
        `SELECT * FROM lab_results WHERE org_id = ? AND order_id = ? AND status <> 'ENTERED_IN_ERROR'
     ORDER BY created_at`, [orgId, r.id as string],
      ).map(resultDto);

  return {
    id: r.id as string, orgId, patientId: r.patient_id as string,
    patientName: r.first_name ? [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(" ") : undefined,
    uhid: (r.uhid as string) ?? undefined,
    encounterId: (r.encounter_id as string) ?? null, admissionId: (r.admission_id as string) ?? null,
    orderNo: r.order_no as string, status: r.status as LabStatus, priority: r.priority as string,
    clinicalNote: r.clinical_note as string,
    orderedBy: r.ordered_by as string, orderedAt: r.ordered_at as string,
    specimen: r.specimen as string, sampleId: (r.sample_id as string) ?? null,
    collectedBy: (r.collected_by as string) ?? null, collectedAt: (r.collected_at as string) ?? null,
    processingStartedAt: (r.processing_started_at as string) ?? null,
    enteredBy: (r.entered_by as string) ?? null, enteredAt: (r.entered_at as string) ?? null,
    verifiedBy: (r.verified_by as string) ?? null, verifiedAt: (r.verified_at as string) ?? null,
    releasedAt: (r.released_at as string) ?? null,
    cancelledBy: (r.cancelled_by as string) ?? null, cancelledAt: (r.cancelled_at as string) ?? null,
    cancelReason: (r.cancel_reason as string) ?? null,
    critical: Boolean(r.critical),
    tests: items, results,
    createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}

const ORDER_SELECT = `
  SELECT o.*, p.first_name, p.middle_name, p.last_name, p.uhid
    FROM lab_orders o
    JOIN patients p ON p.org_id = o.org_id AND p.id = o.patient_id`;

export function listLabOrders(orgId: string, opts: { status?: string; patientId?: string; limit?: number } = {}) {
  const where = ["o.org_id = ?"];
  const params: (string | number)[] = [orgId];
  if (opts.status && opts.status !== "all") {
    if (opts.status === "open") where.push("o.status NOT IN ('RELEASED','CANCELLED')");
    else {
      where.push("o.status = ?");
      params.push(opts.status);
    }
  }
  if (opts.patientId) {
    where.push("o.patient_id = ?");
    params.push(opts.patientId);
  }
  params.push(Math.min(opts.limit ?? 200, 500));
  const rows = all<Record<string, unknown>>(
    `${ORDER_SELECT} WHERE ${where.join(" AND ")} ORDER BY o.ordered_at DESC LIMIT ?`, params,
  );
  const batch = childrenFor(orgId, rows.map((r) => r.id as string));
  return rows.map((r) => orderDto(r, orgId, batch));
}

export function getLabOrder(orgId: string, orderId: string): LabOrderDto {
  const r = get<Record<string, unknown>>(`${ORDER_SELECT} WHERE o.org_id = ? AND o.id = ?`, [orgId, orderId]);
  if (!r) throw new HttpError(404, "Lab order not found in this hospital");
  return orderDto(r, orgId);
}

/* -------------------------------- order -------------------------------- */

export function createLabOrder(ctx: AuditContext, input: {
  patientId: string; testIds?: string[]; testCodes?: string[];
  priority?: string; clinicalNote?: string; encounterId?: string | null; admissionId?: string | null;
}): LabOrderDto {
  requireRow(ctx.orgId, "patients", input.patientId, "Patient");

  const catalog = listTests(ctx.orgId, true);
  const wanted = new Set([...(input.testIds ?? []), ...(input.testCodes ?? [])]);
  const chosen = catalog.filter((t) => wanted.has(t.id) || wanted.has(t.code));
  if (!chosen.length) throw new HttpError(422, "Select at least one test to order");

  const priority = ["routine", "urgent", "stat"].includes(str(input.priority)) ? str(input.priority) : "routine";

  return tx(() => {
    const orderId = id("lord");
    const orderNo = nextLabOrderNo(ctx.orgId);
    const ts = nowIso();
    const specimen = [...new Set(chosen.map((t) => t.specimen))].join(", ");

    run(
      `INSERT INTO lab_orders
         (id, org_id, patient_id, encounter_id, admission_id, order_no, status, priority, clinical_note,
          ordered_by, ordered_by_id, ordered_at, specimen, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'ORDERED', ?,?,?,?,?,?,?,?)`,
      [
        orderId, ctx.orgId, input.patientId, input.encounterId ?? null, input.admissionId ?? null,
        orderNo, priority, str(input.clinicalNote, 1000),
        ctx.session.user.name, ctx.session.user.id, ts, specimen, ts, ts,
      ],
    );

    for (const t of chosen) {
      run(
        "INSERT INTO lab_order_items (id, org_id, order_id, test_id, test_code, test_name, created_at) VALUES (?,?,?,?,?,?,?)",
        [id("litm"), ctx.orgId, orderId, t.id, t.code, t.name, ts],
      );
    }

    clinicalAudit(ctx, {
      patientId: input.patientId, entityType: "lab_order", entityId: orderId,
      action: "lab.ordered", after: { orderNo, tests: chosen.map((t) => t.code), priority },
    });
    addEvent(ctx.orgId, {
      patientId: input.patientId, kind: "lab_order", title: `Lab ordered — ${chosen.map((t) => t.name).join(", ")}`,
      detail: `${orderNo} · ${priority}`, entityType: "lab_order", entityId: orderId, actor: ctx.session.user.name,
    });

    return getLabOrder(ctx.orgId, orderId);
  });
}

/** Moves the order to `to`, applying extra assignments, guarded by the workflow. */
function advance(ctx: AuditContext, orderId: string, to: LabStatus, sets: string[], params: (string | number | null)[]) {
  const order = getLabOrder(ctx.orgId, orderId);
  requireTransition(order.status, to, LAB_TRANSITIONS, "Lab order");
  const assignments = ["status = ?", ...sets, "updated_at = ?"].join(", ");
  run(
    `UPDATE lab_orders SET ${assignments} WHERE org_id = ? AND id = ?`,
    [to, ...params, nowIso(), ctx.orgId, orderId],
  );
  return order;
}

export function collectSample(ctx: AuditContext, orderId: string, input: { specimen?: string; at?: string }): LabOrderDto {
  return tx(() => {
    const sampleId = nextSampleId(ctx.orgId);
    const at = input.at ?? nowIso();
    const before = advance(
      ctx, orderId, "SAMPLE_COLLECTED",
      ["collected_by = ?", "collected_at = ?", "sample_id = ?", "specimen = COALESCE(NULLIF(?,''), specimen)"],
      [ctx.session.user.name, at, sampleId, str(input.specimen, 60)],
    );
    clinicalAudit(ctx, {
      patientId: before.patientId, entityType: "lab_order", entityId: orderId,
      action: "lab.sample_collected", before: { status: before.status }, after: { status: "SAMPLE_COLLECTED", sampleId },
    });
    addEvent(ctx.orgId, {
      patientId: before.patientId, at, kind: "lab_sample", title: `Sample collected — ${sampleId}`,
      detail: before.orderNo, entityType: "lab_order", entityId: orderId, actor: ctx.session.user.name,
    });
    return getLabOrder(ctx.orgId, orderId);
  });
}

export function startProcessing(ctx: AuditContext, orderId: string): LabOrderDto {
  return tx(() => {
    const before = advance(ctx, orderId, "PROCESSING", ["processing_started_at = ?"], [nowIso()]);
    clinicalAudit(ctx, {
      patientId: before.patientId, entityType: "lab_order", entityId: orderId,
      action: "lab.processing", before: { status: before.status }, after: { status: "PROCESSING" },
    });
    return getLabOrder(ctx.orgId, orderId);
  });
}

export interface ResultEntry {
  analyteId?: string;
  analyteCode: string;
  value: string;
}

/**
 * Enters or re-enters results. Values are stored with their numeric form, the
 * analyte's reference band and a derived flag, so downstream consumers never
 * have to re-parse a string.
 */
export function enterResults(ctx: AuditContext, orderId: string, entries: ResultEntry[], amendReason = ""): LabOrderDto {
  const order = getLabOrder(ctx.orgId, orderId);
  if (order.status === "VERIFIED" || order.status === "RELEASED") {
    if (!amendReason) {
      throw new HttpError(409, "This result is verified. Amending it requires a reason, and creates a new version.");
    }
  } else {
    requireTransition(order.status, "RESULT_ENTERED", LAB_TRANSITIONS, "Lab order");
  }

  /*
   * Everything below is interpreted *for this patient*: which reference band
   * applies, whether the number is physiologically possible, and whether it is
   * consistent with their own previous results. A result read against the wrong
   * range, or filed from a mislabelled sample, is a clinical error that no
   * amount of workflow rigour further down will catch.
   */
  const patient = getPatient(ctx.orgId, order.patientId);
  const patientCtx: PatientContext = { sex: patient.gender, ageYears: patient.age };

  const catalog = listTests(ctx.orgId, true);
  /* One analyte code may have several banded rows; keep them all. */
  const bandsByCode = new Map<string, (AnalyteDef & { testId: string })[]>();
  for (const t of catalog) {
    for (const a of t.analytes) {
      const list = bandsByCode.get(a.code) ?? [];
      list.push({ ...a, testId: t.id });
      bandsByCode.set(a.code, list);
    }
  }

  const itemByTestId = new Map(order.tests.map((t) => [t.testId ?? "", t.id]));

  return tx(() => {
    const ts = nowIso();
    let anyCritical = false;
    const criticalRows: { resultId: string; name: string; value: string; flag: ResultFlag }[] = [];
    /** Numeric values entered in this batch, for the derived calculations. */
    const numericByCode: Record<string, number> = {};
    const deltaNotes: string[] = [];

    for (const e of entries) {
      const bands = bandsByCode.get(e.analyteCode);
      if (!bands?.length) throw new HttpError(422, `Unknown analyte code: ${e.analyteCode}`);

      /* Choose the band published for this patient's sex and age. */
      const chosen = pickRange(bands as unknown as RangeDef[], patientCtx);
      const def = (bands.find((b) => b === (chosen.range as unknown)) ?? bands[0]) as AnalyteDef & { testId: string };
      const rangeNote = chosen.note;

      const itemId = itemByTestId.get(def.testId);
      if (!itemId) throw new HttpError(422, `${def.name} is not part of this order`);

      const valueNum = num(e.value);

      /* A slipped decimal point is not a critical result. Refuse it, and say
         what the value probably should have been. */
      const rules: AnalyteRules = { ...def, refText: def.refText } as unknown as AnalyteRules;
      const implausible = checkPlausible(valueNum, rules);
      if (implausible) {
        throw new HttpError(
          422,
          `${implausible.reason}.${implausible.suggestion ? ` ${implausible.suggestion}` : ""} ` +
            `If this value is genuinely correct, record it with a comment rather than as a numeric result.`,
        );
      }

      /* Compare with this patient's own previous result for the same analyte. */
      const previous = get<{ value_num: number | null; entered_at: string | null; created_at: string }>(
        `SELECT r.value_num, r.entered_at, r.created_at
           FROM lab_results r
           JOIN lab_orders o ON o.org_id = r.org_id AND o.id = r.order_id
          WHERE r.org_id = ? AND o.patient_id = ? AND r.analyte_code = ?
            AND r.order_id <> ? AND r.status IN ('FINAL','AMENDED','PRELIMINARY')
          ORDER BY r.created_at DESC LIMIT 1`,
        [ctx.orgId, order.patientId, e.analyteCode, orderId],
      );
      const delta = checkDelta(
        valueNum,
        previous ? { valueNum: previous.value_num, at: previous.entered_at ?? previous.created_at } : null,
        rules,
      );
      if (delta) deltaNotes.push(delta.message);

      if (valueNum !== null) numericByCode[e.analyteCode] = valueNum;

      const flag = flagForRange(valueNum, chosen.range);
      if (isCriticalFlag(flag)) anyCritical = true;

      const existing = get<Record<string, unknown>>(
        "SELECT * FROM lab_results WHERE org_id = ? AND order_id = ? AND analyte_code = ? AND status <> 'ENTERED_IN_ERROR'",
        [ctx.orgId, orderId, e.analyteCode],
      );

      if (existing) {
        // Keep the superseded value before overwriting it.
        run(
          `INSERT INTO lab_result_versions (id, org_id, result_id, version, snapshot, changed_by, reason, created_at)
           VALUES (?,?,?,?,?,?,?,?)`,
          [
            id("lrv"), ctx.orgId, existing.id as string, existing.version as number,
            JSON.stringify(resultDto(existing)), ctx.session.user.name, amendReason || "re-entered before verification", ts,
          ],
        );
        const amended = order.status === "VERIFIED" || order.status === "RELEASED";
        run(
          `UPDATE lab_results SET value_text = ?, value_num = ?, unit = ?, ref_low = ?, ref_high = ?, ref_text = ?,
             flag = ?, status = ?, version = version + 1, entered_by = ?, entered_at = ?, updated_at = ?,
             delta_note = ?, computed = 0
           WHERE org_id = ? AND id = ?`,
          [
            str(e.value, 200), valueNum, def.unit,
            chosen.range?.refLow ?? null, chosen.range?.refHigh ?? null,
            [def.refText, rangeNote].filter(Boolean).join(" "), flag,
            amended ? "AMENDED" : "PRELIMINARY", ctx.session.user.name, ts, ts,
            delta?.message ?? "",
            ctx.orgId, existing.id as string,
          ],
        );
        if (isCriticalFlag(flag)) criticalRows.push({ resultId: existing.id as string, name: def.name, value: e.value, flag });
      } else {
        const rid = id("lres");
        run(
          `INSERT INTO lab_results
             (id, org_id, order_id, item_id, analyte_id, analyte_code, analyte_name, value_text, value_num, unit,
              ref_low, ref_high, ref_text, flag, status, version, entered_by, entered_at, created_at, updated_at, delta_note, computed)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'PRELIMINARY', 1, ?,?,?,?,?,0)`,
          [
            rid, ctx.orgId, orderId, itemId, def.id, def.code, def.name, str(e.value, 200), valueNum, def.unit,
            chosen.range?.refLow ?? null, chosen.range?.refHigh ?? null,
            [def.refText, rangeNote].filter(Boolean).join(" "),
            flag, ctx.session.user.name, ts, ts, ts, delta?.message ?? "",
          ],
        );
        if (isCriticalFlag(flag)) criticalRows.push({ resultId: rid, name: def.name, value: e.value, flag });
      }
    }

    /*
     * Derived values — eGFR, corrected calcium, calculated LDL.
     *
     * Computed here from the values just entered plus the patient's age and
     * sex, and written as results marked `computed` so a reader can tell at a
     * glance that nobody typed them. Where a formula is not valid for this
     * patient (an adult equation for a child, Friedewald above a triglyceride
     * of 400) the reason is stored instead of a number, because a plausible but
     * invalid figure is more dangerous than a blank.
     *
     * Earlier results in the same order are included, so a value entered in a
     * previous session still feeds the calculation.
     */
    for (const prior of all<{ analyte_code: string; value_num: number | null }>(
      "SELECT analyte_code, value_num FROM lab_results WHERE org_id = ? AND order_id = ? AND computed = 0 AND status <> 'ENTERED_IN_ERROR'",
      [ctx.orgId, orderId],
    )) {
      if (prior.value_num !== null && numericByCode[prior.analyte_code] === undefined) {
        numericByCode[prior.analyte_code] = prior.value_num;
      }
    }

    const firstItemId = order.tests[0]?.id ?? "";
    for (const d of computeDerived(numericByCode, patientCtx)) {
      const existingDerived = get<{ id: string }>(
        "SELECT id FROM lab_results WHERE org_id = ? AND order_id = ? AND analyte_code = ?",
        [ctx.orgId, orderId, d.code],
      );
      const text = d.value === null ? "" : String(d.value);
      const note = d.unavailable;
      if (existingDerived) {
        run(
          `UPDATE lab_results SET value_text = ?, value_num = ?, unit = ?, ref_text = ?, flag = 'NORMAL',
             status = 'PRELIMINARY', version = version + 1, entered_by = 'calculated', entered_at = ?, updated_at = ?,
             computed = 1, delta_note = ''
           WHERE org_id = ? AND id = ?`,
          [text, d.value, d.unit, note, ts, ts, ctx.orgId, existingDerived.id],
        );
      } else {
        run(
          `INSERT INTO lab_results
             (id, org_id, order_id, item_id, analyte_id, analyte_code, analyte_name, value_text, value_num, unit,
              ref_low, ref_high, ref_text, flag, status, version, entered_by, entered_at, created_at, updated_at, delta_note, computed)
           VALUES (?,?,?,?,NULL,?,?,?,?,?, NULL, NULL, ?, 'NORMAL', 'PRELIMINARY', 1, 'calculated', ?,?,?,'',1)`,
          [id("lres"), ctx.orgId, orderId, firstItemId, d.code, d.name, text, d.value, d.unit, note, ts, ts, ts],
        );
      }
    }

    const amending = order.status === "VERIFIED" || order.status === "RELEASED";
    run(
      `UPDATE lab_orders SET status = ?, entered_by = ?, entered_at = ?, critical = ?, updated_at = ?
        WHERE org_id = ? AND id = ?`,
      [
        amending ? "RESULT_ENTERED" : "RESULT_ENTERED", ctx.session.user.name, ts,
        anyCritical ? 1 : order.critical ? 1 : 0, ts, ctx.orgId, orderId,
      ],
    );

    // A critical value opens a tracked notification: detected → notified →
    // acknowledged, by a named person. No AI decides anything here.
    for (const c of criticalRows) {
      run(
        `INSERT INTO critical_notifications
           (id, org_id, patient_id, order_id, result_id, analyte_name, value_text, flag, status, detected_at, created_at)
         VALUES (?,?,?,?,?,?,?,?, 'PENDING', ?,?)`,
        [id("crit"), ctx.orgId, order.patientId, orderId, c.resultId, c.name, c.value, c.flag, ts, ts],
      );
      addEvent(ctx.orgId, {
        patientId: order.patientId, kind: "lab_critical", severity: "critical",
        title: `Critical result — ${c.name} ${c.value}`,
        detail: `${c.flag.replace("_", " ").toLowerCase()} · ${order.orderNo} · awaiting clinician acknowledgement`,
        entityType: "lab_order", entityId: orderId, actor: ctx.session.user.name,
      });
    }

    clinicalAudit(ctx, {
      patientId: order.patientId, entityType: "lab_order", entityId: orderId,
      action: amending ? "lab.result_amended" : "lab.result_entered",
      reason: amendReason,
      before: { status: order.status, results: order.results },
      after: { status: "RESULT_ENTERED", entries },
    });
    addEvent(ctx.orgId, {
      patientId: order.patientId, kind: "lab_result",
      title: amending ? `Lab result amended — ${order.orderNo}` : `Lab result entered — ${order.orderNo}`,
      detail: amendReason || `${entries.length} value(s)`,
      entityType: "lab_order", entityId: orderId, actor: ctx.session.user.name,
      severity: anyCritical ? "critical" : "info",
    });

    return getLabOrder(ctx.orgId, orderId);
  });
}

/**
 * Verification is a separate act by a separate permission. The verifier is
 * recorded on the order and on every result line.
 */
export function verifyResults(ctx: AuditContext, orderId: string, note = ""): LabOrderDto {
  return tx(() => {
    const order = getLabOrder(ctx.orgId, orderId);
    requireTransition(order.status, "VERIFIED", LAB_TRANSITIONS, "Lab order");
    if (!order.results.length) throw new HttpError(409, "There are no results to verify");
    if (order.enteredBy && order.enteredBy === ctx.session.user.name) {
      // Not an error — recorded, so a reviewer can see self-verification happened.
      clinicalAudit(ctx, {
        patientId: order.patientId, entityType: "lab_order", entityId: orderId,
        action: "lab.self_verified", reason: "Entered and verified by the same person",
      });
    }
    const ts = nowIso();
    run(
      "UPDATE lab_orders SET status = 'VERIFIED', verified_by = ?, verified_by_id = ?, verified_at = ?, updated_at = ? WHERE org_id = ? AND id = ?",
      [ctx.session.user.name, ctx.session.user.id, ts, ts, ctx.orgId, orderId],
    );
    run(
      `UPDATE lab_results SET status = CASE WHEN status = 'AMENDED' THEN 'AMENDED' ELSE 'FINAL' END,
         verified_by = ?, verified_at = ?, updated_at = ? WHERE org_id = ? AND order_id = ?`,
      [ctx.session.user.name, ts, ts, ctx.orgId, orderId],
    );

    clinicalAudit(ctx, {
      patientId: order.patientId, entityType: "lab_order", entityId: orderId,
      action: "lab.verified", reason: note, before: { status: order.status }, after: { status: "VERIFIED" },
    });
    addEvent(ctx.orgId, {
      patientId: order.patientId, kind: "lab_verified", title: `Lab result verified — ${order.orderNo}`,
      detail: `${order.tests.map((t) => t.name).join(", ")} · verified by ${ctx.session.user.name}`,
      entityType: "lab_order", entityId: orderId, actor: ctx.session.user.name,
      severity: order.critical ? "critical" : "info",
    });
    return getLabOrder(ctx.orgId, orderId);
  });
}

export function releaseResults(ctx: AuditContext, orderId: string): LabOrderDto {
  return tx(() => {
    const order = getLabOrder(ctx.orgId, orderId);
    requireTransition(order.status, "RELEASED", LAB_TRANSITIONS, "Lab order");
    const ts = nowIso();
    run("UPDATE lab_orders SET status = 'RELEASED', released_at = ?, updated_at = ? WHERE org_id = ? AND id = ?", [
      ts, ts, ctx.orgId, orderId,
    ]);
    clinicalAudit(ctx, {
      patientId: order.patientId, entityType: "lab_order", entityId: orderId,
      action: "lab.released", before: { status: order.status }, after: { status: "RELEASED" },
    });
    addEvent(ctx.orgId, {
      patientId: order.patientId, kind: "lab_result", title: `Lab report released — ${order.orderNo}`,
      entityType: "lab_order", entityId: orderId, actor: ctx.session.user.name,
    });

    /*
     * Releasing the report is the billable moment — not ordering it, which may
     * be cancelled, and not entering results, which may be repeated. One charge
     * per order, keyed on the order id, so an amended report re-released later
     * cannot bill the patient twice.
     */
    const priced = all<{ code: string; name: string; price: number }>(
      `SELECT t.code, t.name, t.price
         FROM lab_order_items i JOIN lab_tests t ON t.org_id = i.org_id AND t.id = i.test_id
        WHERE i.org_id = ? AND i.order_id = ?`,
      [ctx.orgId, orderId],
    );
    const total = priced.reduce((sum, t) => sum + (t.price ?? 0), 0);
    raiseCharge({
      orgId: ctx.orgId,
      patientId: order.patientId,
      admissionId: order.admissionId,
      sourceType: "lab_order",
      sourceId: orderId,
      description: `Laboratory — ${order.orderNo}: ${priced.map((t) => t.name).join(", ") || "tests"}`,
      unitAmount: total,
      occurredAt: ts,
      actorId: ctx.session.user.id,
    });

    return getLabOrder(ctx.orgId, orderId);
  });
}

export function cancelLabOrder(ctx: AuditContext, orderId: string, reason: string): LabOrderDto {
  if (!str(reason)) throw new HttpError(422, "A cancellation reason is required");
  return tx(() => {
    const order = getLabOrder(ctx.orgId, orderId);
    requireTransition(order.status, "CANCELLED", LAB_TRANSITIONS, "Lab order");
    const ts = nowIso();
    run(
      "UPDATE lab_orders SET status = 'CANCELLED', cancelled_by = ?, cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE org_id = ? AND id = ?",
      [ctx.session.user.name, ts, str(reason, 400), ts, ctx.orgId, orderId],
    );
    clinicalAudit(ctx, {
      patientId: order.patientId, entityType: "lab_order", entityId: orderId,
      action: "lab.cancelled", reason, before: { status: order.status }, after: { status: "CANCELLED" },
    });
    /* A cancelled order is not billable. If it was already released and then
       cancelled, the charge is withdrawn rather than left on the account. */
    cancelCharge(ctx.orgId, "lab_order", orderId);
    return getLabOrder(ctx.orgId, orderId);
  });
}

/* -------------------------- critical notifications --------------------- */

export function listCriticalNotifications(orgId: string, status?: string) {
  return all<Record<string, unknown>>(
    `SELECT c.*, p.first_name, p.middle_name, p.last_name, p.uhid, o.order_no
       FROM critical_notifications c
       JOIN patients p ON p.org_id = c.org_id AND p.id = c.patient_id
       JOIN lab_orders o ON o.org_id = c.org_id AND o.id = c.order_id
      WHERE c.org_id = ? ${status && status !== "all" ? "AND c.status = ?" : ""}
      ORDER BY c.detected_at DESC LIMIT 200`,
    status && status !== "all" ? [orgId, status] : [orgId],
  ).map((r) => ({
    id: r.id as string, patientId: r.patient_id as string,
    patientName: [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(" "),
    uhid: r.uhid as string, orderId: r.order_id as string, orderNo: r.order_no as string,
    analyteName: r.analyte_name as string, value: r.value_text as string, flag: r.flag as string,
    status: r.status as string, detectedAt: r.detected_at as string,
    notifiedAt: (r.notified_at as string) ?? null, notifiedTo: r.notified_to as string,
    channel: r.channel as string,
    acknowledgedAt: (r.acknowledged_at as string) ?? null, acknowledgedBy: r.acknowledged_by as string,
    note: r.note as string,
  }));
}

export function markNotified(ctx: AuditContext, notificationId: string, to: string, channel: string) {
  const row = requireRow<{ id: string; patient_id: string; status: string }>(
    ctx.orgId, "critical_notifications", notificationId, "Critical notification",
  );
  if (row.status !== "PENDING") throw new HttpError(409, "This notification has already been sent");
  run(
    "UPDATE critical_notifications SET status = 'NOTIFIED', notified_at = ?, notified_to = ?, channel = ? WHERE org_id = ? AND id = ?",
    [nowIso(), str(to, 160), str(channel, 40), ctx.orgId, notificationId],
  );
  clinicalAudit(ctx, {
    patientId: row.patient_id, entityType: "critical_notification", entityId: notificationId,
    action: "critical.notified", after: { to, channel },
  });
}

export function acknowledgeCritical(ctx: AuditContext, notificationId: string, note: string) {
  const row = requireRow<{ id: string; patient_id: string; analyte_name: string }>(
    ctx.orgId, "critical_notifications", notificationId, "Critical notification",
  );
  run(
    "UPDATE critical_notifications SET status = 'ACKNOWLEDGED', acknowledged_at = ?, acknowledged_by = ?, note = ? WHERE org_id = ? AND id = ?",
    [nowIso(), ctx.session.user.name, str(note, 1000), ctx.orgId, notificationId],
  );
  clinicalAudit(ctx, {
    patientId: row.patient_id, entityType: "critical_notification", entityId: notificationId,
    action: "critical.acknowledged", reason: note,
  });
  addEvent(ctx.orgId, {
    patientId: row.patient_id, kind: "lab_critical",
    title: `Critical result acknowledged — ${row.analyte_name}`,
    detail: `by ${ctx.session.user.name}${note ? ` · ${note}` : ""}`,
    entityType: "critical_notification", entityId: notificationId, actor: ctx.session.user.name, severity: "warning",
  });
}

/* ---------------------------- legacy projection ------------------------ */

/**
 * The workspace's cached slice of lab orders. 150 is the recent working set the
 * dashboards summarise; the laboratory screen pages the rest through
 * `/api/lab/orders`, so raising this only costs every page load bandwidth it
 * does not use.
 */
export function legacyLabShape(orgId: string, limit = 150) {
  return listLabOrders(orgId, { limit }).map((o) => ({
    id: o.id, orgId, patientId: o.patientId, providerId: "",
    panel: o.tests.map((t) => t.name).join(", "),
    tests: o.results.map((r) => ({
      name: r.analyteName, value: r.value, unit: r.unit,
      range: r.refText || (r.refLow !== null && r.refHigh !== null ? `${r.refLow}–${r.refHigh}` : ""),
      abnormal: r.flag !== "NORMAL",
    })),
    orderedAt: o.orderedAt,
    status: o.status === "SAMPLE_COLLECTED" ? "collected"
      : o.status === "RESULT_ENTERED" ? "resulted"
      : o.status.toLowerCase(),
    priority: o.priority,
    criticalFlag: o.critical,
    resultedAt: o.enteredAt ?? undefined,
  }));
}
