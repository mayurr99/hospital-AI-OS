/**
 * Patient master service.
 *
 * The patient is the central entity: one permanent identity per hospital, with
 * many visits, admissions, orders and results hanging off it. Nothing clinical
 * is stored on this row — no current ward, no current medication list, no last
 * blood pressure. Those are separate historical records by design.
 */

import { all, get, id, nowIso, run } from "./db";
import { HttpError } from "./auth";
import {
  addEvent, clinicalAudit, nextUhid, requireRow, seedCounter, tx, isUniqueViolation, type AuditContext,
} from "./domain";
import { assertNoConflict, readExpectedVersion } from "./concurrency";
import { ageFromDob, type ValidatedPatient } from "./validate";

export interface PatientRow {
  id: string; org_id: string; uhid: string; external_id: string | null;
  first_name: string; middle_name: string; last_name: string;
  date_of_birth: string | null; age_years: number | null; dob_estimated: number;
  gender: string; mobile: string; alt_mobile: string; email: string;
  blood_group: string | null; preferred_language: string;
  address_line: string; village: string; taluka: string; district: string; state: string; pin: string;
  emergency_name: string; emergency_relation: string; emergency_mobile: string;
  abha_id: string | null; insurance_provider: string; insurance_number: string;
  status: string; deceased_at: string | null; merged_into: string | null;
  facility_id: string | null; department_id: string | null; provider_id: string | null;
  care_pathway: string; risk: string; consent: string; source: string;
  import_batch_id: string | null; last_contact: string | null;
  created_by: string | null; updated_by: string | null; version: number;
  created_at: string; updated_at: string;
}

export interface PatientDto {
  id: string; orgId: string; uhid: string; externalId: string | null;
  firstName: string; middleName: string; lastName: string; fullName: string;
  dateOfBirth: string | null; age: number | null; dobEstimated: boolean;
  gender: string; mobile: string; altMobile: string; email: string;
  bloodGroup: string | null; preferredLanguage: string;
  addressLine: string; village: string; taluka: string; district: string; state: string; pin: string;
  emergencyName: string; emergencyRelation: string; emergencyMobile: string;
  abhaId: string | null; insuranceProvider: string; insuranceNumber: string;
  status: string; deceasedAt: string | null;
  facilityId: string | null; departmentId: string | null; providerId: string | null;
  carePathway: string; risk: string;
  consent: Record<string, unknown>;
  source: string; importBatchId: string | null; lastContact: string | null;
  version: number; createdAt: string; updatedAt: string;
}

export function fullName(r: { first_name: string; middle_name: string; last_name: string }): string {
  return [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function toPatientDto(r: PatientRow): PatientDto {
  let consent: Record<string, unknown> = {};
  try {
    consent = JSON.parse(r.consent || "{}");
  } catch {
    consent = {};
  }
  return {
    id: r.id, orgId: r.org_id, uhid: r.uhid, externalId: r.external_id,
    firstName: r.first_name, middleName: r.middle_name, lastName: r.last_name, fullName: fullName(r),
    dateOfBirth: r.date_of_birth,
    // Age is derived from DOB whenever DOB exists — the stored age is only a
    // fallback for legacy rows that never had one.
    age: r.date_of_birth ? ageFromDob(r.date_of_birth) : r.age_years,
    dobEstimated: Boolean(r.dob_estimated),
    gender: r.gender, mobile: r.mobile, altMobile: r.alt_mobile, email: r.email,
    bloodGroup: r.blood_group, preferredLanguage: r.preferred_language,
    addressLine: r.address_line, village: r.village, taluka: r.taluka,
    district: r.district, state: r.state, pin: r.pin,
    emergencyName: r.emergency_name, emergencyRelation: r.emergency_relation, emergencyMobile: r.emergency_mobile,
    abhaId: r.abha_id, insuranceProvider: r.insurance_provider, insuranceNumber: r.insurance_number,
    status: r.status, deceasedAt: r.deceased_at,
    facilityId: r.facility_id, departmentId: r.department_id, providerId: r.provider_id,
    carePathway: r.care_pathway, risk: r.risk, consent,
    source: r.source, importBatchId: r.import_batch_id, lastContact: r.last_contact,
    version: r.version, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/* ------------------------------- reads -------------------------------- */

export function getPatient(orgId: string, patientId: string): PatientDto {
  return toPatientDto(requireRow<PatientRow>(orgId, "patients", patientId, "Patient"));
}

export function findPatientRow(orgId: string, patientId: string): PatientRow | undefined {
  return get<PatientRow>("SELECT * FROM patients WHERE org_id = ? AND id = ?", [orgId, patientId]);
}

/**
 * Refuse, before anything else runs, a patient id that does not belong to this
 * hospital.
 *
 * The sub-resource routes — vitals, allergies, diagnoses, medications — were
 * already safe, because every query underneath them carries `org_id` and so
 * returned nothing for a foreign patient. But "safe because each query
 * remembered" is a different thing from "safe because the route refused", and
 * only the second one survives somebody adding a fifth sub-resource in a hurry.
 * A penetration test showed the difference plainly: those routes answered a
 * cross-tenant request with `200 {"items": []}` rather than a refusal, which
 * reads as "this patient has no vitals" when the truth is "this patient is not
 * yours".
 *
 * 404 rather than 403, deliberately. Saying "forbidden" would confirm that the
 * id exists somewhere in the system — which, for a patient, is itself a fact
 * worth not disclosing.
 */
export function assertPatientInOrg(orgId: string, patientId: string): PatientRow {
  const row = findPatientRow(orgId, patientId);
  if (!row) throw new HttpError(404, "Patient not found in this hospital");
  return row;
}

export interface PatientSearch {
  q?: string;
  status?: string;
  departmentId?: string;
  providerId?: string;
  risk?: string;
  admitted?: boolean;
  limit?: number;
  offset?: number;
}

export function searchPatients(orgId: string, s: PatientSearch = {}) {
  const where: string[] = ["p.org_id = ?"];
  const params: (string | number)[] = [orgId];

  if (s.status && s.status !== "all") {
    where.push("p.status = ?");
    params.push(s.status);
  }
  if (s.departmentId && s.departmentId !== "all") {
    where.push("p.department_id = ?");
    params.push(s.departmentId);
  }
  if (s.providerId) {
    where.push("p.provider_id = ?");
    params.push(s.providerId);
  }
  if (s.risk && s.risk !== "all") {
    where.push("p.risk = ?");
    params.push(s.risk);
  }
  if (s.q?.trim()) {
    const raw = s.q.trim();
    const q = `%${raw.toLowerCase()}%`;
    const digits = raw.replace(/\D/g, "");

    /*
     * Only search phone numbers when the query actually looks like one.
     *
     * Pulling the digits out of *any* query and matching them against mobile
     * numbers meant that searching a name or an id containing four digits —
     * "Ganeshmu1no228" — also returned every patient whose phone happened to
     * contain "1228". A receptionist looking up one person was shown a
     * stranger's record alongside theirs, with nothing to say why it was there.
     * That is the beginning of the wrong record being opened.
     *
     * A phone search is one where the digits are essentially the whole query:
     * at least four of them, and almost nothing else but separators.
     */
    const nonDigits = raw.replace(/[\d\s+()\-.]/g, "");
    const looksLikePhone = digits.length >= 4 && nonDigits.length === 0;

    where.push(
      `(lower(p.first_name || ' ' || p.middle_name || ' ' || p.last_name) LIKE ?
        OR lower(p.uhid) LIKE ?
        OR lower(IFNULL(p.external_id,'')) LIKE ?
        ${looksLikePhone ? "OR replace(replace(p.mobile,'+',''),' ','') LIKE ?" : ""})`,
    );
    params.push(q, q, q);
    if (looksLikePhone) params.push(`%${digits}%`);
  }

  const limit = Math.min(Math.max(s.limit ?? 100, 1), 500);
  const offset = Math.max(s.offset ?? 0, 0);

  const sql = `
    SELECT p.*,
           a.id            AS adm_id,
           a.admission_no  AS adm_no,
           a.admitted_at   AS adm_at,
           w.name          AS adm_ward,
           b.number        AS adm_bed
      FROM patients p
      LEFT JOIN admissions a
        ON a.org_id = p.org_id AND a.patient_id = p.id AND a.status = 'ACTIVE'
      LEFT JOIN ward_assignments wa
        ON wa.org_id = a.org_id AND wa.admission_id = a.id AND wa.status = 'ACTIVE'
      LEFT JOIN wards w ON w.org_id = wa.org_id AND w.id = wa.ward_id
      LEFT JOIN beds  b ON b.org_id = wa.org_id AND b.id = wa.bed_id
     WHERE ${where.join(" AND ")}
     ${s.admitted ? "AND a.id IS NOT NULL" : ""}
     ORDER BY p.updated_at DESC
     LIMIT ? OFFSET ?`;

  const rows = all<PatientRow & {
    adm_id: string | null; adm_no: string | null; adm_at: string | null;
    adm_ward: string | null; adm_bed: string | null;
  }>(sql, [...params, limit, offset]);

  const total = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM patients p WHERE ${where.join(" AND ")}`, params,
  )?.n ?? 0;

  return {
    total,
    items: rows.map((r) => ({
      ...toPatientDto(r),
      currentAdmission: r.adm_id
        ? { id: r.adm_id, admissionNo: r.adm_no, admittedAt: r.adm_at, ward: r.adm_ward, bed: r.adm_bed }
        : null,
    })),
  };
}

/* ------------------------------- writes ------------------------------- */

export interface CreatePatientOptions {
  source?: string;
  importBatchId?: string | null;
  consent?: Record<string, unknown>;
  risk?: string;
  /**
   * Skip the duplicate guard.
   *
   * Two callers legitimately need this: an operator who has looked at the
   * suggested match and said "no, different person" (`forceCreate`), and a
   * bulk import, which does its own matching across the whole sheet and would
   * otherwise refuse every row that resembles another.
   */
  skipDuplicateCheck?: boolean;
  /**
   * Receives the duplicate matches found *inside* the write transaction.
   *
   * The route does its own check first, for a fast friendly answer, but that
   * one is computed before the write lock is taken — so during a race it sees
   * nothing and reports no matches even though a twin was committed a
   * millisecond earlier. These are the matches that are actually true at the
   * moment of writing, and they are what the caller should report.
   */
  onDuplicates?: (matches: PatientMatch[]) => void;
}

/**
 * Inserts a patient. Generates a UHID when none is supplied.
 *
 * The duplicate check happens *inside* this transaction, and that placement is
 * the whole point of it.
 *
 * Checking in the route and inserting here is a check-then-act race: two
 * receptionists registering the same walk-in at the same second both ask "does
 * this person already exist", both are told no because neither has committed
 * yet, and the hospital ends up with two charts for one person and nothing
 * anywhere saying so. A concurrency test caught exactly that.
 *
 * `tx` takes the write lock up front, so the second registration's check runs
 * after the first has committed and sees it. The route's own check stays —
 * it gives a faster, friendlier answer in the ordinary case — but this is the
 * one that is actually authoritative.
 */
export function createPatient(
  ctx: AuditContext, v: ValidatedPatient, opts: CreatePatientOptions = {},
): PatientDto {
  return tx(() => createPatientLocked(ctx, v, opts));
}

function createPatientLocked(
  ctx: AuditContext, v: ValidatedPatient, opts: CreatePatientOptions = {},
): PatientDto {
  if (!opts.skipDuplicateCheck) {
    const matches = findDuplicates(ctx.orgId, v);
    opts.onDuplicates?.(matches);
    /*
     * Only an exact identifier collision refuses outright. A shared mobile and
     * date of birth is common in one family and is reported rather than
     * blocked — clinical records are never merged on resemblance, and a
     * registration desk that cannot register somebody is worse than a flagged
     * pair a human resolves.
     */
    const strong = matches.find((m) => m.strength === "strong");
    if (strong) {
      throw new HttpError(
        409,
        `A patient already exists: ${strong.name} (${strong.uhid}) — ${strong.reason}. ` +
          `Register anyway only if they are genuinely different people.`,
      );
    }
  }

  const ts = nowIso();
  const pid = id("pat");
  const uhid = v.uhid || nextUhid(ctx.orgId);

  try {
    run(
      `INSERT INTO patients (
         id, org_id, uhid, external_id, first_name, middle_name, last_name,
         date_of_birth, age_years, dob_estimated, gender, mobile, alt_mobile, email,
         blood_group, preferred_language, address_line, village, taluka, district, state, pin,
         emergency_name, emergency_relation, emergency_mobile, abha_id,
         insurance_provider, insurance_number, status, facility_id, department_id, provider_id,
         care_pathway, risk, consent, source, import_batch_id, created_by, updated_by, version, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      [
        pid, ctx.orgId, uhid, v.externalId, v.firstName, v.middleName, v.lastName,
        v.dateOfBirth, v.ageYears, v.dobEstimated ? 1 : 0, v.gender, v.mobile, v.altMobile, v.email,
        v.bloodGroup, v.preferredLanguage, v.addressLine, v.village, v.taluka, v.district, v.state, v.pin,
        v.emergencyName, v.emergencyRelation, v.emergencyMobile, v.abhaId,
        v.insuranceProvider, v.insuranceNumber, v.status, v.facilityId, v.departmentId, v.providerId,
        v.carePathway, opts.risk ?? "green", JSON.stringify(opts.consent ?? defaultConsent()),
        opts.source ?? "manual", opts.importBatchId ?? null,
        ctx.session.user.id, ctx.session.user.id, ts, ts,
      ],
    );
  } catch (e) {
    if (isUniqueViolation(e, "patients_uhid")) throw new HttpError(409, `UHID ${uhid} already exists in this hospital`);
    if (isUniqueViolation(e, "patients_external")) {
      throw new HttpError(409, `External patient id ${v.externalId} already exists in this hospital`);
    }
    throw e;
  }

  const dto = getPatient(ctx.orgId, pid);
  clinicalAudit(ctx, { patientId: pid, entityType: "patient", entityId: pid, action: "patient.created", after: dto });
  addEvent(ctx.orgId, {
    patientId: pid, kind: opts.source === "import" ? "import" : "registration",
    title: opts.source === "import" ? "Imported from spreadsheet" : "Registered",
    detail: `UHID ${uhid}`, entityType: "patient", entityId: pid, actor: ctx.session.user.name,
  });
  return dto;
}

const PATIENT_COLUMNS: Record<string, string> = {
  externalId: "external_id", firstName: "first_name", middleName: "middle_name", lastName: "last_name",
  dateOfBirth: "date_of_birth", ageYears: "age_years", dobEstimated: "dob_estimated", gender: "gender",
  mobile: "mobile", altMobile: "alt_mobile", email: "email", bloodGroup: "blood_group",
  preferredLanguage: "preferred_language", addressLine: "address_line", village: "village",
  taluka: "taluka", district: "district", state: "state", pin: "pin",
  emergencyName: "emergency_name", emergencyRelation: "emergency_relation", emergencyMobile: "emergency_mobile",
  abhaId: "abha_id", insuranceProvider: "insurance_provider", insuranceNumber: "insurance_number",
  status: "status", facilityId: "facility_id", departmentId: "department_id", providerId: "provider_id",
  carePathway: "care_pathway", risk: "risk", lastContact: "last_contact",
};

/** Fields an Excel import is never allowed to touch once a patient exists. */
export const IMPORT_PROTECTED_FIELDS = new Set(["uhid", "status", "abhaId"]);

/**
 * Keys a patch may carry that are not patient fields.
 *
 * `expectedVersion` drives the conflict check, `reason` is recorded with the
 * edit, and the rest are echoes of the record the client read back — harmless
 * to send, meaningless to write.
 */
const PATCH_CONTROL_KEYS = new Set([
  "expectedVersion", "reason", "id", "orgId", "uhid", "version", "createdAt", "updatedAt",
  "fullName", "age", "consent",
]);

export function updatePatient(
  ctx: AuditContext, patientId: string, patch: Record<string, unknown>, reason = "",
): PatientDto {
  /*
   * Refuse a field this endpoint does not write, rather than ignoring it.
   *
   * The column list is a whitelist, which is right — it is what stops a caller
   * setting `org_id` or `uhid` by smuggling it into the body. But silently
   * dropping everything else means a client that sends `phone` instead of
   * `mobile` gets `ok: true` and a record that did not change. Somebody
   * corrects a patient's number, sees no error, and the ward rings the old one.
   *
   * Naming the unrecognised fields costs nothing and turns a silent no-op into
   * an answerable mistake.
   */
  const unknown = Object.keys(patch).filter(
    (k) => !(k in PATIENT_COLUMNS) && !PATCH_CONTROL_KEYS.has(k),
  );
  if (unknown.length) {
    throw new HttpError(
      422,
      `Not a patient field: ${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? ` and ${unknown.length - 5} more` : ""}`,
    );
  }

  /*
   * The whole update runs in one transaction: the conflict check reads the
   * current version, and without the write lock another writer could slip
   * between the check and the UPDATE — which is the very race this is here to
   * prevent.
   */
  return tx(() => {
    const before = getPatient(ctx.orgId, patientId);

    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const touched: string[] = [];
    for (const [key, col] of Object.entries(PATIENT_COLUMNS)) {
      if (!(key in patch)) continue;
      const raw = patch[key];
      const value =
        key === "dobEstimated" ? (raw ? 1 : 0) : raw === undefined || raw === "" ? (raw === "" ? "" : null) : (raw as string | number | null);
      sets.push(`${col} = ?`);
      params.push(value as string | number | null);
      touched.push(key);
    }
    if ("consent" in patch) {
      sets.push("consent = ?");
      params.push(JSON.stringify(patch.consent ?? {}));
      touched.push("consent");
    }
    if (!sets.length) return before;

    /* Refuse only if someone else changed one of the fields this edit touches. */
    assertNoConflict({
      orgId: ctx.orgId,
      entityId: patientId,
      entityLabel: "patient record",
      expectedVersion: readExpectedVersion(patch),
      currentVersion: before.version,
      incomingFields: touched,
    });

    sets.push("updated_at = ?", "updated_by = ?", "version = version + 1");
    params.push(nowIso(), ctx.session.user.id);

    try {
      run(`UPDATE patients SET ${sets.join(", ")} WHERE org_id = ? AND id = ?`, [...params, ctx.orgId, patientId]);
    } catch (e) {
      if (isUniqueViolation(e, "patients_external")) throw new HttpError(409, "That external patient id is already used");
      throw e;
    }

    const after = getPatient(ctx.orgId, patientId);
    clinicalAudit(ctx, {
      patientId, entityType: "patient", entityId: patientId, action: "patient.updated",
      reason, before: diffOnly(before, after, "before"), after: diffOnly(before, after, "after"),
      entityVersion: after.version,
    });
    return after;
  });
}

/** Keeps the audit row small: only the fields that actually changed. */
function diffOnly(before: PatientDto, after: PatientDto, side: "before" | "after") {
  const out: Record<string, unknown> = {};
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  for (const k of Object.keys(a)) {
    if (k === "updatedAt" || k === "version") continue;
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) out[k] = side === "before" ? b[k] : a[k];
  }
  return out;
}

export function defaultConsent() {
  return { clinicalCalls: true, marketing: false, whatsapp: true, recording: false, version: "v2.1", updatedAt: nowIso() };
}

/* -------------------------- duplicate detection ------------------------ */

export type MatchStrength = "strong" | "probable" | "possible" | "none";

export interface PatientMatch {
  patientId: string;
  uhid: string;
  name: string;
  mobile: string;
  dateOfBirth: string | null;
  strength: MatchStrength;
  reason: string;
}

/**
 * Tenant-scoped duplicate detection. Never matches across hospitals: the org_id
 * is part of every predicate, and two hospitals may legitimately hold the same
 * person as two separate patient identities.
 */
export function findDuplicates(orgId: string, v: {
  uhid?: string; externalId?: string | null; mobile?: string;
  dateOfBirth?: string | null; firstName?: string; lastName?: string;
}): PatientMatch[] {
  const out: PatientMatch[] = [];
  const seen = new Set<string>();

  const push = (r: PatientRow, strength: MatchStrength, reason: string) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    out.push({
      patientId: r.id, uhid: r.uhid, name: fullName(r), mobile: r.mobile,
      dateOfBirth: r.date_of_birth, strength, reason,
    });
  };

  if (v.uhid) {
    const r = get<PatientRow>("SELECT * FROM patients WHERE org_id = ? AND uhid = ?", [orgId, v.uhid.toUpperCase()]);
    if (r) push(r, "strong", "Same UHID in this hospital");
  }

  if (v.externalId) {
    const r = get<PatientRow>("SELECT * FROM patients WHERE org_id = ? AND external_id = ?", [orgId, v.externalId]);
    if (r) push(r, "strong", "Same external patient id");
  }

  if (v.mobile && v.dateOfBirth) {
    for (const r of all<PatientRow>(
      "SELECT * FROM patients WHERE org_id = ? AND mobile = ? AND date_of_birth = ?",
      [orgId, v.mobile, v.dateOfBirth],
    )) push(r, "probable", "Same mobile and date of birth");
  }

  if (v.mobile && v.firstName) {
    for (const r of all<PatientRow>(
      "SELECT * FROM patients WHERE org_id = ? AND mobile = ? AND lower(first_name) = lower(?)",
      [orgId, v.mobile, v.firstName],
    )) push(r, "probable", "Same mobile and first name");
  }

  if (v.firstName && v.lastName && v.dateOfBirth) {
    for (const r of all<PatientRow>(
      `SELECT * FROM patients WHERE org_id = ? AND date_of_birth = ?
         AND lower(first_name) = lower(?) AND lower(last_name) = lower(?)`,
      [orgId, v.dateOfBirth, v.firstName, v.lastName],
    )) push(r, "possible", "Same name and date of birth");
  }

  // Name alone is deliberately NOT a match. Clinical histories are never merged
  // on fuzzy name similarity.
  if (v.mobile && !v.dateOfBirth) {
    for (const r of all<PatientRow>("SELECT * FROM patients WHERE org_id = ? AND mobile = ?", [orgId, v.mobile])) {
      push(r, "possible", "Same mobile number");
    }
  }

  return out;
}

/* -------------------------------- allergies ---------------------------- */

export interface AllergyDto {
  id: string; patientId: string; substance: string; category: string; reaction: string;
  severity: string; status: string; onsetDate: string | null; note: string;
  recordedBy: string; recordedAt: string;
}

export function listAllergies(orgId: string, patientId: string, includeInactive = false): AllergyDto[] {
  const rows = all<Record<string, string>>(
    `SELECT * FROM patient_allergies WHERE org_id = ? AND patient_id = ?
     ${includeInactive ? "" : "AND status = 'active'"} ORDER BY
       CASE severity WHEN 'life_threatening' THEN 0 WHEN 'severe' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END,
       substance`,
    [orgId, patientId],
  );
  return rows.map((r) => ({
    id: r.id, patientId: r.patient_id, substance: r.substance, category: r.category,
    reaction: r.reaction, severity: r.severity, status: r.status,
    onsetDate: r.onset_date ?? null, note: r.note, recordedBy: r.recorded_by, recordedAt: r.recorded_at,
  }));
}

export function addAllergy(ctx: AuditContext, patientId: string, input: {
  substance: string; category?: string; reaction?: string; severity?: string; onsetDate?: string | null; note?: string;
}): AllergyDto {
  requireRow(ctx.orgId, "patients", patientId, "Patient");
  const ts = nowIso();
  const aid = id("alg");
  run(
    `INSERT INTO patient_allergies
       (id, org_id, patient_id, substance, category, reaction, severity, status, onset_date, note, recorded_by, recorded_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?, 'active', ?,?,?,?,?,?)`,
    [
      aid, ctx.orgId, patientId, input.substance, input.category ?? "medication",
      input.reaction ?? "", input.severity ?? "moderate", input.onsetDate ?? null,
      input.note ?? "", ctx.session.user.name, ts, ts, ts,
    ],
  );
  const dto = listAllergies(ctx.orgId, patientId, true).find((a) => a.id === aid)!;
  clinicalAudit(ctx, { patientId, entityType: "allergy", entityId: aid, action: "allergy.recorded", after: dto });
  addEvent(ctx.orgId, {
    patientId, kind: "allergy", title: `Allergy recorded — ${input.substance}`,
    detail: `${input.severity ?? "moderate"} · ${input.reaction ?? ""}`.trim(),
    entityType: "allergy", entityId: aid, actor: ctx.session.user.name,
    severity: input.severity === "life_threatening" || input.severity === "severe" ? "critical" : "warning",
  });
  return dto;
}

export function retireAllergy(ctx: AuditContext, patientId: string, allergyId: string, status: "inactive" | "entered_in_error", reason: string) {
  const before = listAllergies(ctx.orgId, patientId, true).find((a) => a.id === allergyId);
  if (!before) throw new HttpError(404, "Allergy not found in this hospital");
  run("UPDATE patient_allergies SET status = ?, updated_at = ? WHERE org_id = ? AND id = ?", [
    status, nowIso(), ctx.orgId, allergyId,
  ]);
  clinicalAudit(ctx, {
    patientId, entityType: "allergy", entityId: allergyId,
    action: status === "entered_in_error" ? "allergy.entered_in_error" : "allergy.inactivated",
    reason, before, after: { ...before, status },
  });
}

/**
 * Best-effort medication/allergy interaction check.
 *
 * Deliberately simple and deliberately advisory: it matches the prescribed
 * medicine or its generic against recorded allergy substances. It assists the
 * prescriber and never blocks them — the clinician records an override reason
 * and the order proceeds.
 */
export function checkAllergyWarning(orgId: string, patientId: string, medicine: string, generic = ""): string {
  const terms = [medicine, generic].filter(Boolean).map((t) => t.toLowerCase());
  if (!terms.length) return "";
  const hits = listAllergies(orgId, patientId)
    .filter((a) => {
      const sub = a.substance.toLowerCase();
      return terms.some((t) => t.includes(sub) || sub.includes(t));
    })
    .map((a) => `${a.substance} (${a.severity}${a.reaction ? `, ${a.reaction}` : ""})`);
  return hits.length ? `Recorded allergy: ${hits.join("; ")}` : "";
}

/* ---------------------------- legacy projection ------------------------ */

/**
 * Projects the relational patient back into the shape the original screens
 * expect, so the existing dashboard, call console and queues keep working while
 * the new clinical screens use the real API.
 */
/**
 * Legacy projection of the patient table.
 *
 * `limit` is not cosmetic: this shape is what the workspace payload carries, and
 * an unbounded version of it is what made a 8,000-patient hospital wait five
 * seconds for every page. Callers that need the whole register (exports) pass
 * `Infinity`; screens take a page. `onlyId` serves the single-patient lookups on
 * the voice path, which used to load the entire register to find one row.
 */
export function legacyPatientShape(orgId: string, opts: { limit?: number; onlyId?: string } = {}) {
  const limit = opts.limit ?? 500;
  const scope: (string | number)[] = [orgId];
  let extra = "";
  if (opts.onlyId) {
    extra = " AND p.id = ?";
    scope.push(opts.onlyId);
  }
  const bounded = Number.isFinite(limit);
  if (bounded) scope.push(limit);

  const rows = all<PatientRow & { adm_at: string | null; disch_at: string | null }>(
    `SELECT p.*, a.admitted_at AS adm_at,
            (SELECT discharged_at FROM admissions d
              WHERE d.org_id = p.org_id AND d.patient_id = p.id AND d.status = 'DISCHARGED'
              ORDER BY d.discharged_at DESC LIMIT 1) AS disch_at
       FROM patients p
       LEFT JOIN admissions a ON a.org_id = p.org_id AND a.patient_id = p.id AND a.status = 'ACTIVE'
      WHERE p.org_id = ?${extra}
      ORDER BY p.updated_at DESC${bounded ? " LIMIT ?" : ""}`,
    scope,
  );

  /*
   * The child lookups are scoped to the rows actually returned. Pulling every
   * allergy in the hospital to decorate 500 patients is the same mistake one
   * level down.
   */
  const ids = rows.map((r) => r.id);
  const holes = ids.length ? ids.map(() => "?").join(",") : "''";
  const scopeChild = ids.length ? [orgId, ...ids] : [orgId];
  const childWhere = ids.length ? ` AND patient_id IN (${holes})` : " AND 0";

  const allergyByPatient = new Map<string, string[]>();
  for (const a of all<{ patient_id: string; substance: string }>(
    `SELECT patient_id, substance FROM patient_allergies WHERE org_id = ? AND status = 'active'${childWhere}`,
    scopeChild,
  )) {
    const list = allergyByPatient.get(a.patient_id) ?? [];
    list.push(a.substance);
    allergyByPatient.set(a.patient_id, list);
  }

  const medsByPatient = new Map<string, { name: string; dose: string; frequency: string }[]>();
  for (const m of all<{ patient_id: string; medicine: string; dose: string; frequency: string }>(
    `SELECT patient_id, medicine, dose, frequency FROM medication_orders
      WHERE org_id = ? AND status = 'ACTIVE'${childWhere}`,
    scopeChild,
  )) {
    const list = medsByPatient.get(m.patient_id) ?? [];
    list.push({ name: m.medicine, dose: m.dose, frequency: m.frequency });
    medsByPatient.set(m.patient_id, list);
  }

  return rows.map((r) => {
    const dto = toPatientDto(r);
    let consent = dto.consent as Record<string, unknown>;
    if (!consent || typeof consent !== "object") consent = defaultConsent();
    return {
      id: r.id, orgId: r.org_id, facilityId: r.facility_id ?? "",
      mrn: r.uhid, name: dto.fullName, age: dto.age ?? 0,
      gender: r.gender === "male" ? "M" : r.gender === "female" ? "F" : "O",
      phone: r.mobile, language: r.preferred_language,
      departmentId: r.department_id ?? "", providerId: r.provider_id ?? "",
      carePathway: r.care_pathway, diagnosis: "",
      allergies: allergyByPatient.get(r.id) ?? [],
      medications: medsByPatient.get(r.id) ?? [],
      consent,
      status: r.adm_at ? "ipd" : r.disch_at ? "discharged" : "opd",
      admittedAt: r.adm_at ?? undefined,
      dischargedAt: r.disch_at ?? undefined,
      lastContact: r.last_contact,
      // The UI's risk vocabulary is green/amber/red; anything else is treated as routine.
      risk: ["green", "amber", "red"].includes(r.risk) ? r.risk : "green",
      abhaId: r.abha_id ?? undefined,
      uhid: r.uhid,
      dateOfBirth: r.date_of_birth,
    };
  });
}

/**
 * Single-patient projection in the legacy shape, for the voice, export and
 * webhook paths that were written against the old record store. They read and
 * write the real `patients` table through these two functions rather than the
 * dead JSON blob.
 */
export function legacyPatientById(orgId: string, patientId: string) {
  const rows: ReturnType<typeof legacyPatientShape> = legacyPatientShape(orgId, { onlyId: patientId, limit: 1 });
  return rows.length ? rows[0] : null;
}

/** Narrow legacy write path: only the fields the voice flow actually changes. */
export function legacyPatientPatch(
  orgId: string,
  patientId: string,
  patch: { risk?: string; lastContact?: string | null; consent?: Record<string, unknown> },
) {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (patch.risk !== undefined) {
    sets.push("risk = ?");
    params.push(patch.risk);
  }
  if (patch.lastContact !== undefined) {
    sets.push("last_contact = ?");
    params.push(patch.lastContact);
  }
  if (patch.consent !== undefined) {
    sets.push("consent = ?");
    params.push(JSON.stringify(patch.consent));
  }
  if (!sets.length) return;
  sets.push("updated_at = ?");
  params.push(nowIso());
  run(`UPDATE patients SET ${sets.join(", ")} WHERE org_id = ? AND id = ?`, [...params, orgId, patientId]);
}

/** Ensures generated UHIDs never collide with imported ones. */
export function reseedUhidCounter(orgId: string) {
  const rows = all<{ uhid: string }>("SELECT uhid FROM patients WHERE org_id = ?", [orgId]);
  let max = 0;
  for (const r of rows) {
    const m = /(\d{6})$/.exec(r.uhid);
    if (m) max = Math.max(max, Number(m[1]));
  }
  if (max > 0) tx(() => seedCounter(orgId, "uhid", max));
}
