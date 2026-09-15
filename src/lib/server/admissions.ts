/**
 * Admission, ward, bed and transfer service.
 *
 * A patient is never "in" a ward. An *admission* holds a *ward assignment*, and
 * the assignment holds the bed. Transfers close one assignment and open the
 * next, so the ward history of a stay is reconstructable in full.
 *
 * Two receptionists clicking the same free bed at the same moment is a real
 * race, and it is handled here by (a) an IMMEDIATE transaction, (b) a
 * conditional UPDATE that only succeeds from a releasable status, and (c) a
 * partial unique index that makes a double-occupied bed impossible even if the
 * application logic were wrong.
 */

import { all, get, id, nowIso, run } from "./db";
import { HttpError } from "./auth";
import {
  addEvent, clinicalAudit, isUniqueViolation, nextAdmissionNo, requireRow, tx, type AuditContext,
} from "./domain";
import { settings } from "./db";
import { requireEnum, str, parseDateTime, ADMISSION_TYPES, BED_STATUSES } from "./validate";
import { accrueBedDays } from "./charges";

export type BedStatus = (typeof BED_STATUSES)[number];

/** Statuses a bed may be occupied from. */
const OCCUPIABLE: BedStatus[] = ["AVAILABLE", "RESERVED"];

export function bedReleaseStatus(orgId: string): BedStatus {
  const v = settings.get<string>(orgId, "ipd.bedReleaseStatus", "CLEANING");
  return (BED_STATUSES as readonly string[]).includes(v) ? (v as BedStatus) : "CLEANING";
}

/* -------------------------------- reads -------------------------------- */

export function listWards(orgId: string) {
  return all<Record<string, unknown>>(
    "SELECT * FROM wards WHERE org_id = ? AND active = 1 ORDER BY floor, name", [orgId],
  ).map((w) => ({
    id: w.id as string, name: w.name as string, type: w.type as string,
    floor: w.floor as number, facilityId: w.facility_id as string | null,
    buildingId: w.building_id as string | null, genderPolicy: w.gender_policy as string,
  }));
}

export interface BedView {
  id: string; wardId: string; wardName: string; roomId: string | null; roomName: string | null;
  number: string; status: BedStatus; dailyRate: number; note: string;
  occupant: null | {
    admissionId: string; admissionNo: string; patientId: string; patientName: string;
    uhid: string; admittedAt: string; assignmentId: string; since: string;
    /** Lab orders for this patient that have not been released. */
    pendingLabs: number;
    /** Critical results still waiting for a named person to acknowledge them. */
    unacknowledgedCriticals: number;
  };
}

export function listBeds(orgId: string, wardId?: string): BedView[] {
  const rows = all<Record<string, unknown>>(
    `SELECT b.*, w.name AS ward_name, r.name AS room_name,
            wa.id AS assignment_id, wa.from_at AS since, wa.admission_id,
            a.admission_no, a.admitted_at, a.patient_id,
            p.first_name, p.middle_name, p.last_name, p.uhid
       FROM beds b
       JOIN wards w ON w.org_id = b.org_id AND w.id = b.ward_id
       LEFT JOIN rooms r ON r.org_id = b.org_id AND r.id = b.room_id
       LEFT JOIN ward_assignments wa ON wa.org_id = b.org_id AND wa.bed_id = b.id AND wa.status = 'ACTIVE'
       LEFT JOIN admissions a ON a.org_id = wa.org_id AND a.id = wa.admission_id
       LEFT JOIN patients p ON p.org_id = a.org_id AND p.id = a.patient_id
      WHERE b.org_id = ? AND b.active = 1 ${wardId ? "AND b.ward_id = ?" : ""}
      ORDER BY w.floor, w.name, b.number`,
    wardId ? [orgId, wardId] : [orgId],
  );

  /*
   * What the laboratory is doing for the people in these beds.
   *
   * The ward board is where nursing staff actually stand, so it is where the
   * answer to "is anything outstanding for this patient" has to appear. Without
   * it the board is a furniture chart and the labs are a separate screen nobody
   * checks during a round — which is how an unacknowledged critical potassium
   * sits unseen for an hour.
   *
   * Two queries for the whole board rather than two per bed.
   */
  const patientIds = rows.map((r) => r.patient_id as string | null).filter(Boolean) as string[];
  const pendingByPatient = new Map<string, number>();
  const criticalByPatient = new Map<string, number>();

  if (patientIds.length) {
    const holes = patientIds.map(() => "?").join(",");
    for (const r of all<{ patient_id: string; n: number }>(
      `SELECT patient_id, COUNT(*) AS n FROM lab_orders
        WHERE org_id = ? AND patient_id IN (${holes})
          AND status NOT IN ('RELEASED','CANCELLED')
        GROUP BY patient_id`,
      [orgId, ...patientIds],
    )) {
      pendingByPatient.set(r.patient_id, r.n);
    }
    for (const r of all<{ patient_id: string; n: number }>(
      `SELECT patient_id, COUNT(*) AS n FROM critical_notifications
        WHERE org_id = ? AND patient_id IN (${holes}) AND status <> 'ACKNOWLEDGED'
        GROUP BY patient_id`,
      [orgId, ...patientIds],
    )) {
      criticalByPatient.set(r.patient_id, r.n);
    }
  }

  return rows.map((r) => {
    const patientId = r.patient_id as string | null;
    return {
      id: r.id as string,
      wardId: r.ward_id as string,
      wardName: r.ward_name as string,
      roomId: (r.room_id as string) ?? null,
      roomName: (r.room_name as string) ?? null,
      number: r.number as string,
      status: r.status as BedStatus,
      dailyRate: (r.daily_rate as number) ?? 0,
      note: (r.note as string) ?? "",
      occupant: r.assignment_id
        ? {
            admissionId: r.admission_id as string,
            admissionNo: r.admission_no as string,
            patientId: r.patient_id as string,
            patientName: [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(" "),
            uhid: r.uhid as string,
            admittedAt: r.admitted_at as string,
            assignmentId: r.assignment_id as string,
            since: r.since as string,
            /** Lab orders not yet released for this patient. */
            pendingLabs: patientId ? pendingByPatient.get(patientId) ?? 0 : 0,
            /** Critical results nobody has acknowledged yet. */
            unacknowledgedCriticals: patientId ? criticalByPatient.get(patientId) ?? 0 : 0,
          }
        : null,
    };
  });
}

export function wardOccupancy(orgId: string) {
  const beds = listBeds(orgId);
  const byWard = new Map<string, { wardId: string; wardName: string; total: number; occupied: number; available: number }>();
  for (const b of beds) {
    const w = byWard.get(b.wardId) ?? { wardId: b.wardId, wardName: b.wardName, total: 0, occupied: 0, available: 0 };
    w.total += 1;
    if (b.status === "OCCUPIED") w.occupied += 1;
    if (b.status === "AVAILABLE") w.available += 1;
    byWard.set(b.wardId, w);
  }
  return [...byWard.values()];
}

export interface AdmissionDto {
  id: string; orgId: string; patientId: string; patientName?: string; uhid?: string;
  admissionNo: string; externalAdmissionId: string | null;
  type: string; status: string;
  facilityId: string | null; departmentId: string | null; providerId: string | null;
  admittedAt: string; dischargedAt: string | null;
  reason: string; referredBy: string;
  dischargeType: string | null; finalDiagnosis: string | null; dischargeSummary: string | null;
  dischargeInstructions: string | null; dischargeProcedures: string | null;
  dischargeDoctorId: string | null; dischargeFollowupDate: string | null;
  currentWard?: { wardId: string; wardName: string; bedId: string; bedNumber: string; since: string } | null;
  createdAt: string; updatedAt: string;
}

function toAdmissionDto(r: Record<string, unknown>): AdmissionDto {
  return {
    id: r.id as string, orgId: r.org_id as string, patientId: r.patient_id as string,
    patientName: r.first_name
      ? [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(" ")
      : undefined,
    uhid: (r.uhid as string) ?? undefined,
    admissionNo: r.admission_no as string,
    externalAdmissionId: (r.external_admission_id as string) ?? null,
    type: r.type as string, status: r.status as string,
    facilityId: (r.facility_id as string) ?? null,
    departmentId: (r.department_id as string) ?? null,
    providerId: (r.provider_id as string) ?? null,
    admittedAt: r.admitted_at as string,
    dischargedAt: (r.discharged_at as string) ?? null,
    reason: (r.reason as string) ?? "", referredBy: (r.referred_by as string) ?? "",
    dischargeType: (r.discharge_type as string) ?? null,
    finalDiagnosis: (r.final_diagnosis as string) ?? null,
    dischargeSummary: (r.discharge_summary as string) ?? null,
    dischargeInstructions: (r.discharge_instructions as string) ?? null,
    dischargeProcedures: (r.discharge_procedures as string) ?? null,
    dischargeDoctorId: (r.discharge_doctor_id as string) ?? null,
    dischargeFollowupDate: (r.discharge_followup_date as string) ?? null,
    currentWard: r.ward_id
      ? {
          wardId: r.ward_id as string, wardName: r.ward_name as string,
          bedId: r.bed_id as string, bedNumber: r.bed_number as string, since: r.since as string,
        }
      : null,
    createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}

const ADMISSION_SELECT = `
  SELECT a.*, p.first_name, p.middle_name, p.last_name, p.uhid,
         wa.ward_id, wa.bed_id, wa.from_at AS since,
         w.name AS ward_name, b.number AS bed_number
    FROM admissions a
    JOIN patients p ON p.org_id = a.org_id AND p.id = a.patient_id
    LEFT JOIN ward_assignments wa ON wa.org_id = a.org_id AND wa.admission_id = a.id AND wa.status = 'ACTIVE'
    LEFT JOIN wards w ON w.org_id = wa.org_id AND w.id = wa.ward_id
    LEFT JOIN beds  b ON b.org_id = wa.org_id AND b.id = wa.bed_id`;

export function listAdmissions(orgId: string, opts: { status?: string; patientId?: string; limit?: number } = {}) {
  const where = ["a.org_id = ?"];
  const params: (string | number)[] = [orgId];
  if (opts.status && opts.status !== "all") {
    where.push("a.status = ?");
    params.push(opts.status);
  }
  if (opts.patientId) {
    where.push("a.patient_id = ?");
    params.push(opts.patientId);
  }
  params.push(Math.min(opts.limit ?? 200, 500));
  return all<Record<string, unknown>>(
    `${ADMISSION_SELECT} WHERE ${where.join(" AND ")} ORDER BY a.admitted_at DESC LIMIT ?`, params,
  ).map(toAdmissionDto);
}

export function getAdmission(orgId: string, admissionId: string): AdmissionDto {
  const r = get<Record<string, unknown>>(`${ADMISSION_SELECT} WHERE a.org_id = ? AND a.id = ?`, [orgId, admissionId]);
  if (!r) throw new HttpError(404, "Admission not found in this hospital");
  return toAdmissionDto(r);
}

export function listWardAssignments(orgId: string, admissionId: string) {
  return all<Record<string, unknown>>(
    `SELECT wa.*, w.name AS ward_name, b.number AS bed_number, r.name AS room_name
       FROM ward_assignments wa
       JOIN wards w ON w.org_id = wa.org_id AND w.id = wa.ward_id
       JOIN beds  b ON b.org_id = wa.org_id AND b.id = wa.bed_id
       LEFT JOIN rooms r ON r.org_id = wa.org_id AND r.id = wa.room_id
      WHERE wa.org_id = ? AND wa.admission_id = ?
      ORDER BY wa.from_at ASC`,
    [orgId, admissionId],
  ).map((r) => ({
    id: r.id as string, wardId: r.ward_id as string, wardName: r.ward_name as string,
    bedId: r.bed_id as string, bedNumber: r.bed_number as string, roomName: (r.room_name as string) ?? null,
    status: r.status as string, fromAt: r.from_at as string, toAt: (r.to_at as string) ?? null,
    reason: r.reason as string, transferReason: r.transfer_reason as string,
    authorizedBy: r.authorized_by as string, assignedBy: r.assigned_by as string,
  }));
}

/* ------------------------------ bed movement --------------------------- */

/**
 * Moves a bed to a new status only if it is currently in one of `from`.
 * Returns false when the conditional update matched nothing, which is how a
 * lost race is detected without a separate read.
 */
function moveBed(orgId: string, bedId: string, from: BedStatus[], to: BedStatus): boolean {
  const placeholders = from.map(() => "?").join(",");
  const res = run(
    `UPDATE beds SET status = ?, updated_at = ? WHERE org_id = ? AND id = ? AND active = 1 AND status IN (${placeholders})`,
    [to, nowIso(), orgId, bedId, ...from],
  );
  return Number(res.changes) === 1;
}

/** Opens a ward assignment and occupies the bed. Must run inside a transaction. */
function openAssignment(ctx: AuditContext, input: {
  admissionId: string; patientId: string; bedId: string;
  reason?: string; transferReason?: string; authorizedBy?: string; at: string;
}) {
  const bed = get<{ id: string; ward_id: string; room_id: string | null; number: string; status: BedStatus }>(
    "SELECT id, ward_id, room_id, number, status FROM beds WHERE org_id = ? AND id = ? AND active = 1",
    [ctx.orgId, input.bedId],
  );
  if (!bed) throw new HttpError(404, "Bed not found in this hospital");

  if (!moveBed(ctx.orgId, bed.id, OCCUPIABLE, "OCCUPIED")) {
    throw new HttpError(409, `Bed ${bed.number} is ${bed.status.toLowerCase()} and cannot be assigned. Pick another bed.`);
  }

  const assignmentId = id("wasg");
  const ts = nowIso();
  try {
    run(
      `INSERT INTO ward_assignments
         (id, org_id, admission_id, patient_id, ward_id, room_id, bed_id, status, from_at, reason, transfer_reason, authorized_by, assigned_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?, 'ACTIVE', ?,?,?,?,?,?,?)`,
      [
        assignmentId, ctx.orgId, input.admissionId, input.patientId, bed.ward_id, bed.room_id, bed.id,
        input.at, input.reason ?? "", input.transferReason ?? "", input.authorizedBy ?? "",
        ctx.session.user.name, ts, ts,
      ],
    );
  } catch (e) {
    if (isUniqueViolation(e, "ward_assign_one_active_bed")) {
      throw new HttpError(409, "That bed was taken a moment ago. Choose another bed.");
    }
    if (isUniqueViolation(e, "ward_assign_one_active_adm")) {
      throw new HttpError(409, "This admission already occupies a bed. Use transfer instead.");
    }
    throw e;
  }
  return { assignmentId, bed };
}

/** Closes the active assignment for an admission and releases its bed. */
function closeAssignment(ctx: AuditContext, admissionId: string, at: string, reason: string) {
  const current = get<{ id: string; bed_id: string; ward_id: string }>(
    "SELECT id, bed_id, ward_id FROM ward_assignments WHERE org_id = ? AND admission_id = ? AND status = 'ACTIVE'",
    [ctx.orgId, admissionId],
  );
  if (!current) return null;

  run(
    "UPDATE ward_assignments SET status = 'CLOSED', to_at = ?, transfer_reason = ?, updated_at = ? WHERE org_id = ? AND id = ?",
    [at, reason, nowIso(), ctx.orgId, current.id],
  );
  // A vacated bed goes to the hospital's configured release status — CLEANING by
  // default — so it is not silently re-offered before it has been turned over.
  moveBed(ctx.orgId, current.bed_id, ["OCCUPIED", "RESERVED"], bedReleaseStatus(ctx.orgId));
  return current;
}

/* ------------------------------- admission ----------------------------- */

export interface CreateAdmissionInput {
  patientId: string;
  type?: string;
  departmentId?: string | null;
  providerId?: string | null;
  facilityId?: string | null;
  admittedAt?: string;
  reason?: string;
  referredBy?: string;
  bedId?: string | null;
  externalAdmissionId?: string | null;
  importBatchId?: string | null;
}

export function createAdmission(ctx: AuditContext, input: CreateAdmissionInput): AdmissionDto {
  const patient = requireRow<{ id: string; first_name: string; last_name: string; status: string }>(
    ctx.orgId, "patients", input.patientId, "Patient",
  );
  if (patient.status === "deceased") throw new HttpError(409, "This patient is recorded as deceased");

  const type = requireEnum(input.type ?? "elective", ADMISSION_TYPES, "type", "elective");
  const admittedAt = parseDateTime(input.admittedAt) ?? nowIso();
  if (new Date(admittedAt).getTime() > Date.now() + 60 * 60 * 1000) {
    throw new HttpError(422, "Admission date cannot be in the future");
  }

  return tx(() => {
    const admissionId = id("adm");
    const admissionNo = nextAdmissionNo(ctx.orgId);
    const ts = nowIso();

    try {
      run(
        `INSERT INTO admissions
           (id, org_id, patient_id, admission_no, external_admission_id, type, status, facility_id, department_id, provider_id,
            admitted_at, reason, referred_by, import_batch_id, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?, 'ACTIVE', ?,?,?,?,?,?,?,?,?,?)`,
        [
          admissionId, ctx.orgId, input.patientId, admissionNo, input.externalAdmissionId ?? null, type,
          input.facilityId ?? null, input.departmentId ?? null, input.providerId ?? null,
          admittedAt, str(input.reason, 400), str(input.referredBy, 160),
          input.importBatchId ?? null, ctx.session.user.id, ts, ts,
        ],
      );
    } catch (e) {
      if (isUniqueViolation(e, "admissions_one_active")) {
        throw new HttpError(409, "This patient already has an active admission. Discharge it before admitting again.");
      }
      throw e;
    }

    let bedInfo = "";
    if (input.bedId) {
      const { bed } = openAssignment(ctx, {
        admissionId, patientId: input.patientId, bedId: input.bedId, reason: "admission", at: admittedAt,
      });
      bedInfo = ` · bed ${bed.number}`;
    }

    clinicalAudit(ctx, {
      patientId: input.patientId, entityType: "admission", entityId: admissionId,
      action: "admission.created", after: { admissionNo, type, admittedAt, bedId: input.bedId ?? null },
    });
    addEvent(ctx.orgId, {
      patientId: input.patientId, at: admittedAt, kind: "admission",
      title: `Admitted — ${admissionNo}`, detail: `${type}${bedInfo}${input.reason ? ` · ${input.reason}` : ""}`,
      entityType: "admission", entityId: admissionId, actor: ctx.session.user.name,
    });

    return getAdmission(ctx.orgId, admissionId);
  });
}

/** Assigns a bed to an admission that does not yet have one. */
export function assignBed(ctx: AuditContext, admissionId: string, bedId: string, reason = ""): AdmissionDto {
  const admission = getAdmission(ctx.orgId, admissionId);
  if (admission.status !== "ACTIVE") throw new HttpError(409, "Only an active admission can be given a bed");
  if (admission.currentWard) throw new HttpError(409, "This admission already occupies a bed. Use transfer instead.");

  return tx(() => {
    const { bed } = openAssignment(ctx, {
      admissionId, patientId: admission.patientId, bedId, reason, at: nowIso(),
    });
    clinicalAudit(ctx, {
      patientId: admission.patientId, entityType: "ward_assignment", entityId: admissionId,
      action: "bed.assigned", after: { bedId, bedNumber: bed.number },
    });
    addEvent(ctx.orgId, {
      patientId: admission.patientId, kind: "admission", title: `Bed assigned — ${bed.number}`,
      detail: reason, entityType: "admission", entityId: admissionId, actor: ctx.session.user.name,
    });
    return getAdmission(ctx.orgId, admissionId);
  });
}

/* -------------------------------- transfer ----------------------------- */

export interface TransferInput {
  toBedId: string;
  reason: string;
  authorizedBy: string;
  at?: string;
}

/**
 * Atomic ward/bed transfer: close the old assignment, release the old bed,
 * occupy the destination bed, open the new assignment, write the audit entry.
 * Any failure rolls the whole thing back — there is no window in which the
 * patient occupies two beds or none.
 */
export function transferAdmission(ctx: AuditContext, admissionId: string, input: TransferInput): AdmissionDto {
  const admission = getAdmission(ctx.orgId, admissionId);
  if (admission.status !== "ACTIVE") throw new HttpError(409, "Only an active admission can be transferred");
  if (!admission.currentWard) throw new HttpError(409, "This admission has no current bed. Assign one instead.");
  if (admission.currentWard.bedId === input.toBedId) throw new HttpError(422, "The patient is already in that bed");

  const reason = str(input.reason, 400);
  if (!reason) throw new HttpError(422, "A transfer reason is required");
  const authorizedBy = str(input.authorizedBy, 160);
  if (!authorizedBy) throw new HttpError(422, "Transfer must record who authorised it");

  const at = parseDateTime(input.at) ?? nowIso();

  return tx(() => {
    const from = admission.currentWard!;
    closeAssignment(ctx, admissionId, at, reason);
    const { bed } = openAssignment(ctx, {
      admissionId, patientId: admission.patientId, bedId: input.toBedId,
      reason: "transfer", transferReason: reason, authorizedBy, at,
    });

    clinicalAudit(ctx, {
      patientId: admission.patientId, entityType: "ward_assignment", entityId: admissionId,
      action: "admission.transferred", reason,
      before: { wardId: from.wardId, ward: from.wardName, bedId: from.bedId, bed: from.bedNumber },
      after: { wardId: bed.ward_id, bedId: bed.id, bed: bed.number, authorizedBy },
    });
    addEvent(ctx.orgId, {
      patientId: admission.patientId, at, kind: "transfer",
      title: `Transferred — ${from.wardName} ${from.bedNumber} → bed ${bed.number}`,
      detail: `${reason} · authorised by ${authorizedBy}`,
      entityType: "admission", entityId: admissionId, actor: ctx.session.user.name, severity: "warning",
    });

    /* The stay in the old bed is now closed, so its bed-days are final and can
       be charged at that bed's rate rather than the new one's. */
    accrueBedDays(ctx.orgId, admissionId, ctx.session.user.id);

    return getAdmission(ctx.orgId, admissionId);
  });
}

/* -------------------------------- discharge ---------------------------- */

export interface DischargeInput {
  dischargedAt?: string;
  dischargeType?: string;
  finalDiagnosis: string;
  dischargeSummary: string;
  instructions?: string;
  procedures?: string;
  dischargeDoctorId?: string | null;
  followupDate?: string | null;
}

export const DISCHARGE_TYPES = ["routine", "lama", "referred", "absconded", "expired"] as const;

/**
 * Closes the admission and releases the bed. The admission row is never
 * deleted — it becomes DISCHARGED and keeps its full ward history.
 */
export function dischargeAdmission(ctx: AuditContext, admissionId: string, input: DischargeInput): AdmissionDto {
  const admission = getAdmission(ctx.orgId, admissionId);
  if (admission.status !== "ACTIVE") throw new HttpError(409, `Admission is already ${admission.status.toLowerCase()}`);

  const finalDiagnosis = str(input.finalDiagnosis, 600);
  if (!finalDiagnosis) throw new HttpError(422, "A final diagnosis is required to discharge");
  const summary = str(input.dischargeSummary, 8000);
  if (!summary) throw new HttpError(422, "A discharge summary is required");

  const dischargedAt = parseDateTime(input.dischargedAt) ?? nowIso();
  if (new Date(dischargedAt) < new Date(admission.admittedAt)) {
    throw new HttpError(422, "Discharge date cannot be before the admission date");
  }
  const dischargeType = requireEnum(input.dischargeType ?? "routine", DISCHARGE_TYPES, "dischargeType", "routine");

  return tx(() => {
    const released = closeAssignment(ctx, admissionId, dischargedAt, `discharge (${dischargeType})`);

    run(
      `UPDATE admissions SET status = ?, discharged_at = ?, discharge_type = ?, final_diagnosis = ?,
         discharge_summary = ?, discharge_instructions = ?, discharge_procedures = ?,
         discharge_doctor_id = ?, discharge_followup_date = ?, updated_at = ?
       WHERE org_id = ? AND id = ?`,
      [
        dischargeType === "expired" ? "EXPIRED" : dischargeType === "lama" ? "LAMA"
          : dischargeType === "absconded" ? "ABSCONDED" : "DISCHARGED",
        dischargedAt, dischargeType, finalDiagnosis, summary,
        str(input.instructions, 4000), str(input.procedures, 2000),
        input.dischargeDoctorId ?? null, input.followupDate ?? null, nowIso(),
        ctx.orgId, admissionId,
      ],
    );

    if (dischargeType === "expired") {
      run("UPDATE patients SET status = 'deceased', deceased_at = ?, updated_at = ? WHERE org_id = ? AND id = ?", [
        dischargedAt, nowIso(), ctx.orgId, admission.patientId,
      ]);
    }

    // Any medication order that was tied to this admission stops with it.
    run(
      `UPDATE medication_orders SET status = 'COMPLETED', updated_at = ?
        WHERE org_id = ? AND admission_id = ? AND status = 'ACTIVE'`,
      [nowIso(), ctx.orgId, admissionId],
    );

    clinicalAudit(ctx, {
      patientId: admission.patientId, entityType: "admission", entityId: admissionId,
      action: "admission.discharged",
      before: { status: "ACTIVE", bedId: released?.bed_id ?? null },
      after: { status: "DISCHARGED", dischargeType, dischargedAt, finalDiagnosis },
    });
    addEvent(ctx.orgId, {
      patientId: admission.patientId, at: dischargedAt, kind: "discharge",
      title: `Discharged — ${admission.admissionNo}`,
      detail: `${dischargeType} · ${finalDiagnosis}`,
      entityType: "admission", entityId: admissionId, actor: ctx.session.user.name,
    });

    /*
     * Bed charges for the whole stay, recomputed from the ward assignments.
     * Recomputing rather than incrementing means a backdated discharge, a
     * transfer between beds at different rates, or a server that was off
     * overnight all produce the same, correct set of days.
     */
    accrueBedDays(ctx.orgId, admissionId, ctx.session.user.id);

    return getAdmission(ctx.orgId, admissionId);
  });
}

/* ------------------------------ bed admin ------------------------------ */

export function setBedStatus(ctx: AuditContext, bedId: string, status: BedStatus, note = ""): BedView {
  const bed = requireRow<{ id: string; number: string; status: BedStatus }>(ctx.orgId, "beds", bedId, "Bed");
  if (bed.status === "OCCUPIED" && status !== "OCCUPIED") {
    const occupied = get("SELECT 1 AS x FROM ward_assignments WHERE org_id = ? AND bed_id = ? AND status = 'ACTIVE'", [
      ctx.orgId, bedId,
    ]);
    if (occupied) throw new HttpError(409, "This bed holds an active admission. Transfer or discharge the patient first.");
  }
  if (status === "OCCUPIED") throw new HttpError(422, "A bed becomes occupied by admitting or transferring a patient into it");

  run("UPDATE beds SET status = ?, note = ?, updated_at = ? WHERE org_id = ? AND id = ?", [
    status, note, nowIso(), ctx.orgId, bedId,
  ]);
  clinicalAudit(ctx, {
    entityType: "bed", entityId: bedId, action: "bed.status_changed",
    before: { status: bed.status }, after: { status, note },
  });
  return listBeds(ctx.orgId).find((b) => b.id === bedId)!;
}

/* ------------------------------------------------------------------ */
/* Creating wards and beds                                             */
/*                                                                     */
/* These were missing outright. `bed` and `ward` were withdrawn from    */
/* the generic record route — correctly, so that status rules and the   */
/* clinical audit trail apply — but nothing was put in their place, so  */
/* the route answered "use /api/beds" and /api/beds had only a GET. The */
/* result: a hospital that signed up today had no wards, no beds, and   */
/* no way to add any. The entire admissions module was unreachable for  */
/* every new tenant, and the only hospitals it worked for were the demo */
/* ones, whose beds arrive with the seed.                               */
/* ------------------------------------------------------------------ */

export interface WardInput {
  name: string;
  type?: string;
  floor?: number;
  facilityId?: string | null;
  buildingId?: string | null;
  genderPolicy?: "any" | "male" | "female";
}

export function createWard(ctx: AuditContext, input: WardInput) {
  const name = String(input.name ?? "").trim();
  if (!name) throw new HttpError(422, "A ward needs a name");

  /* Two wards called "ICU" on the same floor is a transfer error waiting to
     happen, so it is refused here rather than left to the eye. */
  const clash = get<{ id: string }>(
    "SELECT id FROM wards WHERE org_id = ? AND active = 1 AND lower(name) = lower(?)",
    [ctx.orgId, name],
  );
  if (clash) throw new HttpError(409, `A ward called "${name}" already exists`);

  const wardId = id("wrd");
  const ts = nowIso();
  run(
    `INSERT INTO wards (id, org_id, facility_id, building_id, name, type, floor, gender_policy, active, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,1,?,?)`,
    [
      wardId, ctx.orgId, input.facilityId ?? null, input.buildingId ?? null, name,
      input.type ?? "general", Number(input.floor) || 0, input.genderPolicy ?? "any", ts, ts,
    ],
  );
  clinicalAudit(ctx, {
    entityType: "ward", entityId: wardId, action: "ward.created",
    before: null, after: { name, type: input.type ?? "general", floor: Number(input.floor) || 0 },
  });
  return listWards(ctx.orgId).find((w) => w.id === wardId)!;
}

export function updateWard(ctx: AuditContext, wardId: string, input: Partial<WardInput>) {
  const before = requireRow<Record<string, unknown>>(ctx.orgId, "wards", wardId, "Ward");
  const name = input.name === undefined ? String(before.name) : String(input.name).trim();
  if (!name) throw new HttpError(422, "A ward needs a name");

  run(
    `UPDATE wards SET name = ?, type = ?, floor = ?, gender_policy = ?, updated_at = ?
      WHERE org_id = ? AND id = ?`,
    [
      name,
      input.type ?? String(before.type),
      input.floor === undefined ? Number(before.floor) : Number(input.floor) || 0,
      input.genderPolicy ?? String(before.gender_policy),
      nowIso(), ctx.orgId, wardId,
    ],
  );
  clinicalAudit(ctx, {
    entityType: "ward", entityId: wardId, action: "ward.updated",
    before: { name: before.name, type: before.type, floor: before.floor },
    after: { name, type: input.type ?? before.type, floor: input.floor ?? before.floor },
  });
  return listWards(ctx.orgId).find((w) => w.id === wardId)!;
}

/**
 * Closing a ward.
 *
 * Deactivated, never deleted: a discharged patient's record says which ward
 * they were in, and deleting the row would turn that into a dangling id in a
 * medical record. A ward with anybody in it cannot be closed at all.
 */
export function closeWard(ctx: AuditContext, wardId: string) {
  requireRow<Record<string, unknown>>(ctx.orgId, "wards", wardId, "Ward");
  const occupied = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ward_assignments wa
       JOIN beds b ON b.org_id = wa.org_id AND b.id = wa.bed_id
      WHERE wa.org_id = ? AND b.ward_id = ? AND wa.status = 'ACTIVE'`,
    [ctx.orgId, wardId],
  );
  if ((occupied?.n ?? 0) > 0) {
    throw new HttpError(409, `This ward still has ${occupied?.n} patient${occupied?.n === 1 ? "" : "s"} in it. Transfer or discharge them first.`);
  }
  run("UPDATE wards SET active = 0, updated_at = ? WHERE org_id = ? AND id = ?", [nowIso(), ctx.orgId, wardId]);
  run("UPDATE beds SET active = 0, updated_at = ? WHERE org_id = ? AND ward_id = ?", [nowIso(), ctx.orgId, wardId]);
  clinicalAudit(ctx, { entityType: "ward", entityId: wardId, action: "ward.closed", before: { active: 1 }, after: { active: 0 } });
  return { ok: true };
}

export interface BedInput {
  wardId: string;
  number: string;
  dailyRate?: number;
  roomId?: string | null;
  note?: string;
}

export function createBed(ctx: AuditContext, input: BedInput): BedView {
  requireRow<Record<string, unknown>>(ctx.orgId, "wards", String(input.wardId ?? ""), "Ward");
  const number = String(input.number ?? "").trim();
  if (!number) throw new HttpError(422, "A bed needs a number");

  /* The unique index would catch this, but a 409 with a sentence is a better
     answer than a constraint error with a column name in it. */
  const clash = get<{ id: string }>(
    "SELECT id FROM beds WHERE org_id = ? AND ward_id = ? AND number = ?",
    [ctx.orgId, input.wardId, number],
  );
  if (clash) throw new HttpError(409, `Bed ${number} already exists in this ward`);

  const bedId = id("bed");
  const ts = nowIso();
  run(
    `INSERT INTO beds (id, org_id, ward_id, room_id, number, status, daily_rate, active, note, created_at, updated_at)
     VALUES (?,?,?,?,?,'AVAILABLE',?,1,?,?,?)`,
    [bedId, ctx.orgId, input.wardId, input.roomId ?? null, number, Math.max(0, Number(input.dailyRate) || 0), input.note ?? "", ts, ts],
  );
  clinicalAudit(ctx, {
    entityType: "bed", entityId: bedId, action: "bed.created",
    before: null, after: { wardId: input.wardId, number, dailyRate: Number(input.dailyRate) || 0 },
  });
  return listBeds(ctx.orgId, input.wardId).find((b) => b.id === bedId)!;
}

/**
 * Add a run of beds in one go — "ICU-01" through "ICU-12".
 *
 * Nobody sets up a forty-bed ward one bed at a time, and making them do it is
 * how a hospital ends up with a half-configured ward on the first afternoon.
 * Numbers that already exist are skipped rather than failing the whole batch,
 * so running it twice to fill a gap does the sensible thing.
 */
export function createBedRun(
  ctx: AuditContext,
  input: { wardId: string; prefix: string; from: number; to: number; pad?: number; dailyRate?: number },
): { created: BedView[]; skipped: string[] } {
  requireRow<Record<string, unknown>>(ctx.orgId, "wards", String(input.wardId ?? ""), "Ward");
  const from = Math.floor(Number(input.from));
  const to = Math.floor(Number(input.to));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    throw new HttpError(422, "Give a range like 1 to 12");
  }
  /* A guard against a typo turning into ten thousand rows. */
  if (to - from + 1 > 200) throw new HttpError(422, "That would create more than 200 beds in one go — split it up");

  const pad = Math.min(4, Math.max(0, Number(input.pad ?? 2)));
  const created: BedView[] = [];
  const skipped: string[] = [];

  return tx(() => {
    for (let n = from; n <= to; n++) {
      const number = `${input.prefix ?? ""}${String(n).padStart(pad, "0")}`;
      const exists = get<{ id: string }>(
        "SELECT id FROM beds WHERE org_id = ? AND ward_id = ? AND number = ?",
        [ctx.orgId, input.wardId, number],
      );
      if (exists) { skipped.push(number); continue; }
      created.push(createBed(ctx, { wardId: input.wardId, number, dailyRate: input.dailyRate }));
    }
    return { created, skipped };
  });
}

export function updateBed(ctx: AuditContext, bedId: string, input: { number?: string; dailyRate?: number; note?: string }) {
  const before = requireRow<Record<string, unknown>>(ctx.orgId, "beds", bedId, "Bed");
  const number = input.number === undefined ? String(before.number) : String(input.number).trim();
  if (!number) throw new HttpError(422, "A bed needs a number");
  if (number !== before.number) {
    const clash = get<{ id: string }>(
      "SELECT id FROM beds WHERE org_id = ? AND ward_id = ? AND number = ? AND id <> ?",
      [ctx.orgId, String(before.ward_id), number, bedId],
    );
    if (clash) throw new HttpError(409, `Bed ${number} already exists in this ward`);
  }
  run(
    "UPDATE beds SET number = ?, daily_rate = ?, note = ?, updated_at = ? WHERE org_id = ? AND id = ?",
    [
      number,
      input.dailyRate === undefined ? Number(before.daily_rate) : Math.max(0, Number(input.dailyRate) || 0),
      input.note === undefined ? String(before.note) : String(input.note),
      nowIso(), ctx.orgId, bedId,
    ],
  );
  clinicalAudit(ctx, {
    entityType: "bed", entityId: bedId, action: "bed.updated",
    before: { number: before.number, dailyRate: before.daily_rate },
    after: { number, dailyRate: input.dailyRate ?? before.daily_rate },
  });
  return listBeds(ctx.orgId).find((b) => b.id === bedId)!;
}

/** Retire a bed. Same reasoning as a ward: deactivated, and never while occupied. */
export function retireBed(ctx: AuditContext, bedId: string) {
  const bed = requireRow<{ id: string; number: string; status: string }>(ctx.orgId, "beds", bedId, "Bed");
  const occupied = get("SELECT 1 AS x FROM ward_assignments WHERE org_id = ? AND bed_id = ? AND status = 'ACTIVE'", [
    ctx.orgId, bedId,
  ]);
  if (occupied) throw new HttpError(409, "This bed holds an active admission. Transfer or discharge the patient first.");
  run("UPDATE beds SET active = 0, updated_at = ? WHERE org_id = ? AND id = ?", [nowIso(), ctx.orgId, bedId]);
  clinicalAudit(ctx, { entityType: "bed", entityId: bedId, action: "bed.retired", before: { active: 1, number: bed.number }, after: { active: 0 } });
  return { ok: true };
}

/** Projects beds/wards into the legacy record shape the original screens read. */
export function legacyWardShape(orgId: string) {
  return listWards(orgId).map((w) => ({
    id: w.id, orgId, facilityId: w.facilityId ?? "", name: w.name, type: w.type, floor: w.floor,
  }));
}

export function legacyBedShape(orgId: string) {
  return listBeds(orgId).map((b) => ({
    id: b.id, orgId, wardId: b.wardId, number: b.number,
    status: b.status.toLowerCase(),
    patientId: b.occupant?.patientId ?? null,
    admittedAt: b.occupant?.admittedAt,
    dailyRate: b.dailyRate,
  }));
}
