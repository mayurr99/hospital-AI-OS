/**
 * Encounters, vitals, diagnoses, medication orders and documents.
 *
 * Everything here is historical by construction. An encounter is amended into a
 * new version rather than overwritten; vitals are a time series; a medication is
 * stopped rather than deleted. Nothing in this module hard-deletes a clinical
 * record.
 */

import { all, get, id, nowIso, run } from "./db";
import { HttpError } from "./auth";
import {
  addEvent, clinicalAudit, nextEncounterNo, requireRow, tx, type AuditContext,
} from "./domain";
import { checkAllergyWarning } from "./patients";
import { int, num, parseDate, parseDateTime, requireEnum, str, ROUTES } from "./validate";

/* ------------------------------- encounters ---------------------------- */

export const ENCOUNTER_TYPES = ["opd", "ipd", "emergency", "teleconsult", "followup"] as const;

export const ENCOUNTER_SECTIONS = [
  "chiefComplaint", "hpi", "pastHistory", "familyHistory", "examination",
  "assessment", "plan", "notes", "procedures", "followupInstructions",
] as const;

const SECTION_COLUMN: Record<string, string> = {
  chiefComplaint: "chief_complaint", hpi: "hpi", pastHistory: "past_history",
  familyHistory: "family_history", examination: "examination", assessment: "assessment",
  plan: "plan", notes: "notes", procedures: "procedures", followupInstructions: "followup_instructions",
};

export interface EncounterDto {
  id: string; orgId: string; patientId: string; patientName?: string; uhid?: string;
  encounterNo: string; type: string; status: string;
  facilityId: string | null; departmentId: string | null; providerId: string | null;
  admissionId: string | null; appointmentId: string | null;
  startedAt: string; endedAt: string | null;
  chiefComplaint: string; hpi: string; pastHistory: string; familyHistory: string;
  examination: string; assessment: string; plan: string; notes: string; procedures: string;
  followupDate: string | null; followupInstructions: string;
  version: number; signedBy: string | null; signedAt: string | null;
  createdAt: string; updatedAt: string;
}

function encounterDto(r: Record<string, unknown>): EncounterDto {
  return {
    id: r.id as string, orgId: r.org_id as string, patientId: r.patient_id as string,
    patientName: r.first_name ? [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(" ") : undefined,
    uhid: (r.uhid as string) ?? undefined,
    encounterNo: r.encounter_no as string, type: r.type as string, status: r.status as string,
    facilityId: (r.facility_id as string) ?? null,
    departmentId: (r.department_id as string) ?? null,
    providerId: (r.provider_id as string) ?? null,
    admissionId: (r.admission_id as string) ?? null,
    appointmentId: (r.appointment_id as string) ?? null,
    startedAt: r.started_at as string, endedAt: (r.ended_at as string) ?? null,
    chiefComplaint: r.chief_complaint as string, hpi: r.hpi as string,
    pastHistory: r.past_history as string, familyHistory: r.family_history as string,
    examination: r.examination as string, assessment: r.assessment as string,
    plan: r.plan as string, notes: r.notes as string, procedures: r.procedures as string,
    followupDate: (r.followup_date as string) ?? null,
    followupInstructions: r.followup_instructions as string,
    version: r.version as number, signedBy: (r.signed_by as string) ?? null,
    signedAt: (r.signed_at as string) ?? null,
    createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}

const ENC_SELECT = `
  SELECT e.*, p.first_name, p.middle_name, p.last_name, p.uhid
    FROM encounters e JOIN patients p ON p.org_id = e.org_id AND p.id = e.patient_id`;

export function listEncounters(orgId: string, opts: { patientId?: string; status?: string; providerId?: string; limit?: number } = {}) {
  const where = ["e.org_id = ?"];
  const params: (string | number)[] = [orgId];
  if (opts.patientId) {
    where.push("e.patient_id = ?");
    params.push(opts.patientId);
  }
  if (opts.status && opts.status !== "all") {
    where.push("e.status = ?");
    params.push(opts.status);
  }
  if (opts.providerId) {
    where.push("e.provider_id = ?");
    params.push(opts.providerId);
  }
  params.push(Math.min(opts.limit ?? 100, 500));
  return all<Record<string, unknown>>(
    `${ENC_SELECT} WHERE ${where.join(" AND ")} ORDER BY e.started_at DESC LIMIT ?`, params,
  ).map(encounterDto);
}

export function getEncounter(orgId: string, encounterId: string): EncounterDto {
  const r = get<Record<string, unknown>>(`${ENC_SELECT} WHERE e.org_id = ? AND e.id = ?`, [orgId, encounterId]);
  if (!r) throw new HttpError(404, "Encounter not found in this hospital");
  return encounterDto(r);
}

export function createEncounter(ctx: AuditContext, input: Record<string, unknown>): EncounterDto {
  const patientId = str(input.patientId, 60);
  requireRow(ctx.orgId, "patients", patientId, "Patient");
  const type = requireEnum(str(input.type) || "opd", ENCOUNTER_TYPES, "type", "opd");

  const admissionId = str(input.admissionId, 60) || null;
  if (admissionId) requireRow(ctx.orgId, "admissions", admissionId, "Admission");

  return tx(() => {
    const eid = id("enc");
    const no = nextEncounterNo(ctx.orgId);
    const ts = nowIso();
    const startedAt = parseDateTime(input.startedAt) ?? ts;

    run(
      `INSERT INTO encounters
         (id, org_id, patient_id, encounter_no, type, status, facility_id, department_id, provider_id,
          admission_id, appointment_id, started_at, chief_complaint, hpi, past_history, family_history,
          examination, assessment, plan, notes, procedures, followup_date, followup_instructions,
          version, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?, 'in_progress', ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 1, ?,?,?)`,
      [
        eid, ctx.orgId, patientId, no, type,
        str(input.facilityId, 60) || null, str(input.departmentId, 60) || null,
        str(input.providerId, 60) || ctx.session.user.providerId || null,
        admissionId, str(input.appointmentId, 60) || null, startedAt,
        str(input.chiefComplaint, 1000), str(input.hpi, 4000), str(input.pastHistory, 4000),
        str(input.familyHistory, 2000), str(input.examination, 4000), str(input.assessment, 4000),
        str(input.plan, 4000), str(input.notes, 6000), str(input.procedures, 2000),
        parseDate(input.followupDate), str(input.followupInstructions, 2000),
        ctx.session.user.id, ts, ts,
      ],
    );

    const dto = getEncounter(ctx.orgId, eid);
    clinicalAudit(ctx, { patientId, entityType: "encounter", entityId: eid, action: "encounter.created", after: dto });
    addEvent(ctx.orgId, {
      patientId, at: startedAt, kind: "encounter", title: `${type.toUpperCase()} encounter — ${no}`,
      detail: dto.chiefComplaint, entityType: "encounter", entityId: eid, actor: ctx.session.user.name,
    });
    return dto;
  });
}

/**
 * Updates an encounter's clinical sections. The previous version is snapshotted
 * into `encounter_versions` first, so an amended note never erases what the
 * clinician originally wrote.
 */
export function updateEncounter(
  ctx: AuditContext, encounterId: string, patch: Record<string, unknown>, reason = "",
): EncounterDto {
  const before = getEncounter(ctx.orgId, encounterId);
  if (before.status === "entered_in_error") throw new HttpError(409, "This encounter is marked entered-in-error");

  return tx(() => {
    run(
      `INSERT INTO encounter_versions (id, org_id, encounter_id, version, snapshot, changed_by, reason, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id("env"), ctx.orgId, encounterId, before.version, JSON.stringify(before), ctx.session.user.name, reason, nowIso()],
    );

    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    for (const key of ENCOUNTER_SECTIONS) {
      if (!(key in patch)) continue;
      sets.push(`${SECTION_COLUMN[key]} = ?`);
      params.push(str(patch[key], 8000));
    }
    if ("followupDate" in patch) {
      sets.push("followup_date = ?");
      params.push(parseDate(patch.followupDate));
    }
    if ("departmentId" in patch) {
      sets.push("department_id = ?");
      params.push(str(patch.departmentId, 60) || null);
    }
    if ("providerId" in patch) {
      sets.push("provider_id = ?");
      params.push(str(patch.providerId, 60) || null);
    }
    if (!sets.length) return before;

    sets.push("version = version + 1", "updated_at = ?");
    params.push(nowIso());
    run(`UPDATE encounters SET ${sets.join(", ")} WHERE org_id = ? AND id = ?`, [...params, ctx.orgId, encounterId]);

    const after = getEncounter(ctx.orgId, encounterId);
    clinicalAudit(ctx, {
      patientId: before.patientId, entityType: "encounter", entityId: encounterId,
      action: "encounter.amended", reason, before, after,
    });
    return after;
  });
}

export function closeEncounter(ctx: AuditContext, encounterId: string, sign = true): EncounterDto {
  const before = getEncounter(ctx.orgId, encounterId);
  if (before.status === "completed") return before;
  if (before.status !== "in_progress" && before.status !== "planned") {
    throw new HttpError(409, `Encounter is ${before.status}`);
  }
  const ts = nowIso();
  run(
    "UPDATE encounters SET status = 'completed', ended_at = ?, signed_by = ?, signed_at = ?, updated_at = ? WHERE org_id = ? AND id = ?",
    [ts, sign ? ctx.session.user.name : null, sign ? ts : null, ts, ctx.orgId, encounterId],
  );
  const after = getEncounter(ctx.orgId, encounterId);
  clinicalAudit(ctx, {
    patientId: before.patientId, entityType: "encounter", entityId: encounterId,
    action: "encounter.completed", before: { status: before.status }, after: { status: "completed", signedBy: after.signedBy },
  });
  addEvent(ctx.orgId, {
    patientId: before.patientId, kind: "encounter", title: `Encounter completed — ${before.encounterNo}`,
    detail: after.assessment.slice(0, 200), entityType: "encounter", entityId: encounterId, actor: ctx.session.user.name,
  });
  return after;
}

/** Clinical records are corrected, not deleted. */
export function markEncounterInError(ctx: AuditContext, encounterId: string, reason: string): EncounterDto {
  if (!str(reason)) throw new HttpError(422, "A reason is required to mark an encounter entered-in-error");
  const before = getEncounter(ctx.orgId, encounterId);
  run("UPDATE encounters SET status = 'entered_in_error', updated_at = ? WHERE org_id = ? AND id = ?", [
    nowIso(), ctx.orgId, encounterId,
  ]);
  clinicalAudit(ctx, {
    patientId: before.patientId, entityType: "encounter", entityId: encounterId,
    action: "encounter.entered_in_error", reason, before, after: { ...before, status: "entered_in_error" },
  });
  return getEncounter(ctx.orgId, encounterId);
}

export function listEncounterVersions(orgId: string, encounterId: string) {
  return all<Record<string, unknown>>(
    "SELECT * FROM encounter_versions WHERE org_id = ? AND encounter_id = ? ORDER BY version DESC",
    [orgId, encounterId],
  ).map((r) => ({
    version: r.version as number, changedBy: r.changed_by as string,
    reason: r.reason as string, at: r.created_at as string,
    snapshot: JSON.parse(r.snapshot as string) as EncounterDto,
  }));
}

/* --------------------------------- vitals ------------------------------ */

export interface VitalsDto {
  id: string; patientId: string; encounterId: string | null; admissionId: string | null;
  recordedAt: string; recordedBy: string;
  temperatureC: number | null; systolic: number | null; diastolic: number | null;
  pulse: number | null; respiratoryRate: number | null; spo2: number | null;
  heightCm: number | null; weightKg: number | null; bloodGlucose: number | null;
  painScore: number | null; note: string; status: string;
  bmi: number | null;
}

function vitalsDto(r: Record<string, unknown>): VitalsDto {
  const h = r.height_cm as number | null;
  const w = r.weight_kg as number | null;
  return {
    id: r.id as string, patientId: r.patient_id as string,
    encounterId: (r.encounter_id as string) ?? null, admissionId: (r.admission_id as string) ?? null,
    recordedAt: r.recorded_at as string, recordedBy: r.recorded_by as string,
    temperatureC: r.temperature_c as number | null,
    systolic: r.systolic as number | null, diastolic: r.diastolic as number | null,
    pulse: r.pulse as number | null, respiratoryRate: r.respiratory_rate as number | null,
    spo2: r.spo2 as number | null, heightCm: h, weightKg: w,
    bloodGlucose: r.blood_glucose as number | null, painScore: r.pain_score as number | null,
    note: r.note as string, status: r.status as string,
    bmi: h && w && h > 0 ? Math.round((w / (h / 100) ** 2) * 10) / 10 : null,
  };
}

export function listVitals(orgId: string, patientId: string, limit = 100): VitalsDto[] {
  return all<Record<string, unknown>>(
    "SELECT * FROM vitals WHERE org_id = ? AND patient_id = ? AND status = 'final' ORDER BY recorded_at DESC LIMIT ?",
    [orgId, patientId, limit],
  ).map(vitalsDto);
}

/** Server-side plausibility bounds. Out-of-range values are rejected, not clamped. */
const VITAL_RANGES: Record<string, [number, number, string]> = {
  temperatureC: [25, 45, "Temperature must be between 25 and 45 °C"],
  systolic: [40, 300, "Systolic pressure must be between 40 and 300 mmHg"],
  diastolic: [20, 200, "Diastolic pressure must be between 20 and 200 mmHg"],
  pulse: [20, 300, "Pulse must be between 20 and 300 bpm"],
  respiratoryRate: [4, 80, "Respiratory rate must be between 4 and 80 /min"],
  spo2: [40, 100, "SpO₂ must be between 40 and 100 %"],
  heightCm: [20, 260, "Height must be between 20 and 260 cm"],
  weightKg: [0.3, 400, "Weight must be between 0.3 and 400 kg"],
  bloodGlucose: [10, 1200, "Blood glucose must be between 10 and 1200 mg/dL"],
  painScore: [0, 10, "Pain score must be between 0 and 10"],
};

export function recordVitals(ctx: AuditContext, input: Record<string, unknown>): VitalsDto {
  const patientId = str(input.patientId, 60);
  requireRow(ctx.orgId, "patients", patientId, "Patient");

  const v: Record<string, number | null> = {
    temperatureC: num(input.temperatureC), systolic: int(input.systolic), diastolic: int(input.diastolic),
    pulse: int(input.pulse), respiratoryRate: int(input.respiratoryRate), spo2: int(input.spo2),
    heightCm: num(input.heightCm), weightKg: num(input.weightKg),
    bloodGlucose: num(input.bloodGlucose), painScore: int(input.painScore),
  };

  for (const [key, val] of Object.entries(v)) {
    if (val === null) continue;
    const [lo, hi, msg] = VITAL_RANGES[key];
    if (val < lo || val > hi) throw new HttpError(422, msg);
  }
  if (v.systolic !== null && v.diastolic !== null && v.diastolic >= v.systolic) {
    throw new HttpError(422, "Diastolic pressure must be lower than systolic");
  }
  if (Object.values(v).every((x) => x === null)) throw new HttpError(422, "Record at least one vital sign");

  const vid = id("vit");
  const recordedAt = parseDateTime(input.recordedAt) ?? nowIso();
  if (new Date(recordedAt).getTime() > Date.now() + 5 * 60 * 1000) {
    throw new HttpError(422, "Vitals cannot be recorded in the future");
  }

  run(
    `INSERT INTO vitals (id, org_id, patient_id, encounter_id, admission_id, recorded_at, recorded_by,
       temperature_c, systolic, diastolic, pulse, respiratory_rate, spo2, height_cm, weight_kg,
       blood_glucose, pain_score, note, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'final', ?)`,
    [
      vid, ctx.orgId, patientId, str(input.encounterId, 60) || null, str(input.admissionId, 60) || null,
      recordedAt, ctx.session.user.name,
      v.temperatureC, v.systolic, v.diastolic, v.pulse, v.respiratoryRate, v.spo2,
      v.heightCm, v.weightKg, v.bloodGlucose, v.painScore, str(input.note, 500), nowIso(),
    ],
  );

  const dto = listVitals(ctx.orgId, patientId, 1).find((x) => x.id === vid)!;
  clinicalAudit(ctx, { patientId, entityType: "vitals", entityId: vid, action: "vitals.recorded", after: dto });
  addEvent(ctx.orgId, {
    patientId, at: recordedAt, kind: "vitals", title: "Vitals recorded",
    detail: summariseVitals(dto), entityType: "vitals", entityId: vid, actor: ctx.session.user.name,
  });
  return dto;
}

export function summariseVitals(v: VitalsDto): string {
  const parts: string[] = [];
  if (v.systolic && v.diastolic) parts.push(`BP ${v.systolic}/${v.diastolic}`);
  if (v.pulse) parts.push(`HR ${v.pulse}`);
  if (v.spo2) parts.push(`SpO₂ ${v.spo2}%`);
  if (v.temperatureC) parts.push(`${v.temperatureC}°C`);
  if (v.respiratoryRate) parts.push(`RR ${v.respiratoryRate}`);
  if (v.bloodGlucose) parts.push(`Glucose ${v.bloodGlucose}`);
  if (v.painScore !== null) parts.push(`Pain ${v.painScore}/10`);
  return parts.join(" · ");
}

/* -------------------------------- diagnoses ---------------------------- */

export const DIAGNOSIS_CATEGORIES = ["provisional", "final", "differential", "comorbidity"] as const;

export function listDiagnoses(orgId: string, patientId: string, includeInactive = false) {
  return all<Record<string, unknown>>(
    `SELECT * FROM diagnoses WHERE org_id = ? AND patient_id = ?
      ${includeInactive ? "" : "AND status = 'active'"} ORDER BY recorded_at DESC`,
    [orgId, patientId],
  ).map((r) => ({
    id: r.id as string, patientId: r.patient_id as string,
    encounterId: (r.encounter_id as string) ?? null, admissionId: (r.admission_id as string) ?? null,
    codeSystem: r.code_system as string, code: r.code as string, description: r.description as string,
    category: r.category as string, rank: r.rank as string, status: r.status as string,
    onsetDate: (r.onset_date as string) ?? null,
    recordedBy: r.recorded_by as string, recordedAt: r.recorded_at as string,
  }));
}

export function addDiagnosis(ctx: AuditContext, input: Record<string, unknown>) {
  const patientId = str(input.patientId, 60);
  requireRow(ctx.orgId, "patients", patientId, "Patient");
  const description = str(input.description, 500);
  if (!description) throw new HttpError(422, "A diagnosis description is required");
  const category = requireEnum(str(input.category) || "provisional", DIAGNOSIS_CATEGORIES, "category", "provisional");

  const did = id("dx");
  const ts = nowIso();
  run(
    `INSERT INTO diagnoses (id, org_id, patient_id, encounter_id, admission_id, code_system, code, description,
       category, rank, status, onset_date, recorded_by, recorded_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'active', ?,?,?,?,?)`,
    [
      did, ctx.orgId, patientId, str(input.encounterId, 60) || null, str(input.admissionId, 60) || null,
      str(input.codeSystem, 40) || "free-text", str(input.code, 40), description,
      category, str(input.rank) === "primary" ? "primary" : "secondary",
      parseDate(input.onsetDate), ctx.session.user.name, ts, ts, ts,
    ],
  );
  const dto = listDiagnoses(ctx.orgId, patientId, true).find((d) => d.id === did)!;
  clinicalAudit(ctx, { patientId, entityType: "diagnosis", entityId: did, action: "diagnosis.recorded", after: dto });
  addEvent(ctx.orgId, {
    patientId, kind: "diagnosis", title: `Diagnosis — ${description}`,
    detail: `${category}${input.code ? ` · ${str(input.code, 40)}` : ""}`,
    entityType: "diagnosis", entityId: did, actor: ctx.session.user.name,
  });
  return dto;
}

export function setDiagnosisStatus(ctx: AuditContext, diagnosisId: string, status: "resolved" | "entered_in_error", reason: string) {
  const row = requireRow<{ id: string; patient_id: string; description: string; status: string }>(
    ctx.orgId, "diagnoses", diagnosisId, "Diagnosis",
  );
  if (status === "entered_in_error" && !str(reason)) throw new HttpError(422, "A reason is required");
  run("UPDATE diagnoses SET status = ?, updated_at = ? WHERE org_id = ? AND id = ?", [
    status, nowIso(), ctx.orgId, diagnosisId,
  ]);
  clinicalAudit(ctx, {
    patientId: row.patient_id, entityType: "diagnosis", entityId: diagnosisId,
    action: `diagnosis.${status}`, reason, before: { status: row.status }, after: { status },
  });
}

/* ---------------------------- medication orders ------------------------ */

export interface MedicationDto {
  id: string; patientId: string; encounterId: string | null; admissionId: string | null;
  medicine: string; genericName: string; strength: string; form: string;
  dose: string; route: string; frequency: string; timing: string; prn: boolean;
  durationDays: number | null; startDate: string | null; endDate: string | null;
  instructions: string; status: string; stoppedReason: string;
  allergyWarning: string; allergyOverrideReason: string;
  prescribedBy: string; prescribedAt: string;
}

function medDto(r: Record<string, unknown>): MedicationDto {
  return {
    id: r.id as string, patientId: r.patient_id as string,
    encounterId: (r.encounter_id as string) ?? null, admissionId: (r.admission_id as string) ?? null,
    medicine: r.medicine as string, genericName: r.generic_name as string,
    strength: r.strength as string, form: r.form as string,
    dose: r.dose as string, route: r.route as string, frequency: r.frequency as string,
    timing: r.timing as string, prn: Boolean(r.prn),
    durationDays: r.duration_days as number | null,
    startDate: (r.start_date as string) ?? null, endDate: (r.end_date as string) ?? null,
    instructions: r.instructions as string, status: r.status as string,
    stoppedReason: r.stopped_reason as string,
    allergyWarning: r.allergy_warning as string, allergyOverrideReason: r.allergy_override_reason as string,
    prescribedBy: r.prescribed_by as string, prescribedAt: r.prescribed_at as string,
  };
}

export function listMedications(orgId: string, patientId: string, activeOnly = false): MedicationDto[] {
  return all<Record<string, unknown>>(
    `SELECT * FROM medication_orders WHERE org_id = ? AND patient_id = ?
      ${activeOnly ? "AND status = 'ACTIVE'" : ""} ORDER BY prescribed_at DESC`,
    [orgId, patientId],
  ).map(medDto);
}

export function prescribe(ctx: AuditContext, input: Record<string, unknown>): MedicationDto {
  const patientId = str(input.patientId, 60);
  requireRow(ctx.orgId, "patients", patientId, "Patient");

  const medicine = str(input.medicine, 200);
  if (!medicine) throw new HttpError(422, "A medicine name is required");
  const dose = str(input.dose, 60);
  if (!dose) throw new HttpError(422, "A dose is required");
  const frequency = str(input.frequency, 60);
  if (!frequency) throw new HttpError(422, "A frequency is required");
  const route = requireEnum(str(input.route) || "oral", ROUTES, "route", "oral");

  const durationDays = int(input.durationDays);
  if (durationDays !== null && (durationDays < 1 || durationDays > 365)) {
    throw new HttpError(422, "Duration must be between 1 and 365 days");
  }
  const startDate = parseDate(input.startDate) ?? nowIso().slice(0, 10);
  let endDate = parseDate(input.endDate);
  if (!endDate && durationDays) {
    const d = new Date(`${startDate}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + durationDays - 1);
    endDate = d.toISOString().slice(0, 10);
  }
  if (endDate && endDate < startDate) throw new HttpError(422, "End date cannot be before the start date");

  const generic = str(input.genericName, 200);
  // Advisory only. The prescriber decides; the system records the decision.
  const warning = checkAllergyWarning(ctx.orgId, patientId, medicine, generic);
  const override = str(input.allergyOverrideReason, 500);
  if (warning && !override) {
    throw new HttpError(409, `${warning}. Confirm with an override reason to proceed — this warning assists, it does not replace clinical judgment.`);
  }

  const mid = id("med");
  const ts = nowIso();
  run(
    `INSERT INTO medication_orders
       (id, org_id, patient_id, encounter_id, admission_id, drug_id, medicine, generic_name, strength, form,
        dose, route, frequency, timing, prn, duration_days, start_date, end_date, instructions,
        status, allergy_warning, allergy_override_reason, prescribed_by, prescribed_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ACTIVE', ?,?,?,?,?,?)`,
    [
      mid, ctx.orgId, patientId, str(input.encounterId, 60) || null, str(input.admissionId, 60) || null,
      str(input.drugId, 60) || null, medicine, generic, str(input.strength, 60), str(input.form, 40),
      dose, route, frequency, str(input.timing, 60), input.prn ? 1 : 0,
      durationDays, startDate, endDate, str(input.instructions, 1000),
      warning, override, ctx.session.user.name, ts, ts, ts,
    ],
  );

  const dto = listMedications(ctx.orgId, patientId).find((m) => m.id === mid)!;
  clinicalAudit(ctx, {
    patientId, entityType: "medication_order", entityId: mid, action: "medication.prescribed",
    reason: override, after: dto,
  });
  addEvent(ctx.orgId, {
    patientId, kind: "prescription", title: `Prescribed — ${medicine} ${str(input.strength, 60)}`.trim(),
    detail: `${dose} ${route} ${frequency}${durationDays ? ` · ${durationDays} days` : ""}`,
    entityType: "medication_order", entityId: mid, actor: ctx.session.user.name,
    severity: warning ? "warning" : "info",
  });
  return dto;
}

/** The only states a prescription can be moved into. Mirrors the CHECK constraint. */
export const MEDICATION_END_STATUSES = ["STOPPED", "COMPLETED", "CANCELLED", "ENTERED_IN_ERROR"] as const;
export type MedicationEndStatus = (typeof MEDICATION_END_STATUSES)[number];

export function stopMedication(ctx: AuditContext, medId: string, reason: string, statusInput: unknown = "STOPPED") {
  /*
   * Check the value here, not in the type.
   *
   * The parameter used to be typed as the four permitted strings, which reads
   * like validation and is not: TypeScript is gone at runtime, so a client
   * sending `"stopped"` in lower case went straight into the UPDATE and came
   * back as a 500 carrying `CHECK constraint failed: status IN ('ACTIVE',...)`.
   * That is a crash where a refusal belonged, and it hands a prober the column
   * name and its permitted values for free.
   */
  const status = requireEnum(
    typeof statusInput === "string" ? statusInput.toUpperCase() : statusInput,
    MEDICATION_END_STATUSES,
    "status",
    "STOPPED",
  );

  const row = requireRow<{ id: string; patient_id: string; medicine: string; status: string }>(
    ctx.orgId, "medication_orders", medId, "Medication order",
  );
  if (status !== "COMPLETED" && !str(reason)) throw new HttpError(422, "A reason is required");
  run("UPDATE medication_orders SET status = ?, stopped_reason = ?, updated_at = ? WHERE org_id = ? AND id = ?", [
    status, str(reason, 500), nowIso(), ctx.orgId, medId,
  ]);
  clinicalAudit(ctx, {
    patientId: row.patient_id, entityType: "medication_order", entityId: medId,
    action: `medication.${status.toLowerCase()}`, reason,
    before: { status: row.status }, after: { status },
  });
  addEvent(ctx.orgId, {
    patientId: row.patient_id, kind: "prescription", title: `${row.medicine} ${status.toLowerCase()}`,
    detail: reason, entityType: "medication_order", entityId: medId, actor: ctx.session.user.name, severity: "warning",
  });
}

/* -------------------------------- documents ---------------------------- */

export function listDocuments(orgId: string, patientId: string) {
  return all<Record<string, unknown>>(
    "SELECT * FROM documents WHERE org_id = ? AND patient_id = ? AND status = 'active' ORDER BY uploaded_at DESC",
    [orgId, patientId],
  ).map((r) => ({
    id: r.id as string, title: r.title as string, category: r.category as string,
    mime: r.mime as string, bytes: r.bytes as number, storageKey: r.storage_key as string,
    encounterId: (r.encounter_id as string) ?? null, admissionId: (r.admission_id as string) ?? null,
    uploadedBy: r.uploaded_by as string, uploadedAt: r.uploaded_at as string,
  }));
}

export function addDocument(ctx: AuditContext, input: {
  patientId: string; title: string; category?: string; mime?: string;
  bytes?: number; storageKey?: string; encounterId?: string | null; admissionId?: string | null;
}) {
  requireRow(ctx.orgId, "patients", input.patientId, "Patient");
  const did = id("doc");
  const ts = nowIso();
  run(
    `INSERT INTO documents (id, org_id, patient_id, encounter_id, admission_id, title, category, mime, storage_key, bytes, status, uploaded_by, uploaded_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'active', ?,?,?)`,
    [
      did, ctx.orgId, input.patientId, input.encounterId ?? null, input.admissionId ?? null,
      str(input.title, 200), str(input.category, 40) || "other", str(input.mime, 100) || "application/octet-stream",
      str(input.storageKey, 300), input.bytes ?? 0, ctx.session.user.name, ts, ts,
    ],
  );
  clinicalAudit(ctx, {
    patientId: input.patientId, entityType: "document", entityId: did, action: "document.uploaded",
    after: { title: input.title, category: input.category },
  });
  addEvent(ctx.orgId, {
    patientId: input.patientId, kind: "document", title: `Document — ${input.title}`,
    detail: str(input.category, 40), entityType: "document", entityId: did, actor: ctx.session.user.name,
  });
  return listDocuments(ctx.orgId, input.patientId).find((d) => d.id === did)!;
}
