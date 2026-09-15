/**
 * One-way migration from the original generic `records` store into the
 * relational clinical core, plus the standard laboratory catalogue.
 *
 * The original build kept patients, wards, beds and lab orders as JSON blobs in
 * a single table. Rather than drop that data, this module reshapes it:
 *
 *   records(kind='patient')  → patients (+ patient_allergies, medication_orders)
 *   records(kind='ward')     → wards
 *   records(kind='bed')      → beds (+ admissions + ward_assignments for occupants)
 *   records(kind='labOrder') → lab_orders + lab_order_items + lab_results
 *
 * It is idempotent per hospital and runs once at boot and once after a new
 * tenant is provisioned. The legacy rows are left in place, unread, so a
 * rollback is a code change rather than a data recovery exercise.
 *
 * Clinical content in the lab catalogue is illustrative and must be replaced by
 * the hospital's own validated reference ranges before any live use.
 */

import { all, get, id, nowIso, records, run } from "./db";
import { seedCounter, tx } from "./domain";
import { ageFromDob, dobFromAge, normalizeMobile } from "./validate";

/* ------------------------- laboratory catalogue ------------------------ */

interface SeedAnalyte {
  code: string; name: string; unit: string;
  refLow?: number; refHigh?: number; criticalLow?: number; criticalHigh?: number; refText?: string;
  /**
   * Who this range applies to. An analyte may appear several times with
   * different bands — that is how a sex- or age-specific reference range is
   * expressed, and why `appliesSex` and the age bounds exist at all.
   */
  appliesSex?: "male" | "female" | "any";
  ageMinYears?: number; ageMaxYears?: number;
  /** Values outside these are data-entry errors, not results. */
  plausibleLow?: number; plausibleHigh?: number;
  /** A change this large from the patient's previous result is queried. */
  deltaAbs?: number; deltaPct?: number;
  decimals?: number;
}
interface SeedTest {
  code: string; name: string; category: string; specimen: string; tatHours: number; analytes: SeedAnalyte[];
  /**
   * Indicative list price in rupees. Every hospital prices differently and most
   * have payer-specific tariffs, so these are a starting point to be replaced —
   * but a starting point is better than zero, which silently bills nothing.
   */
  price?: number;
}

export const LAB_CATALOG: SeedTest[] = [
  {
    code: "CBC", price: 350, name: "Complete Blood Count", category: "Haematology", specimen: "blood", tatHours: 4,
    analytes: [
      /* Haemoglobin is the clearest case for banded ranges: the same number is
         normal in a woman, anaemic in a man, and normal again in a child. */
      { code: "HB", name: "Haemoglobin", unit: "g/dL", appliesSex: "male", ageMinYears: 15,
        refLow: 13, refHigh: 17, criticalLow: 7, criticalHigh: 20,
        plausibleLow: 2, plausibleHigh: 25, deltaAbs: 2, deltaPct: 20, decimals: 1 },
      { code: "HB", name: "Haemoglobin", unit: "g/dL", appliesSex: "female", ageMinYears: 15,
        refLow: 12, refHigh: 15, criticalLow: 7, criticalHigh: 20,
        plausibleLow: 2, plausibleHigh: 25, deltaAbs: 2, deltaPct: 20, decimals: 1 },
      { code: "HB", name: "Haemoglobin", unit: "g/dL", ageMinYears: 0, ageMaxYears: 15,
        refLow: 11, refHigh: 14, criticalLow: 7, criticalHigh: 20,
        plausibleLow: 2, plausibleHigh: 25, deltaAbs: 2, deltaPct: 20, decimals: 1 },
      { code: "HB", name: "Haemoglobin", unit: "g/dL", refLow: 12, refHigh: 16, criticalLow: 7, criticalHigh: 20,
        plausibleLow: 2, plausibleHigh: 25, deltaAbs: 2, deltaPct: 20, decimals: 1 },

      { code: "WBC", name: "Total Leucocyte Count", unit: "10³/µL", refLow: 4, refHigh: 11, criticalLow: 1.5, criticalHigh: 30,
        plausibleLow: 0.1, plausibleHigh: 400, deltaPct: 60, decimals: 1 },
      { code: "PLT", name: "Platelet Count", unit: "10³/µL", refLow: 150, refHigh: 410, criticalLow: 50, criticalHigh: 1000,
        plausibleLow: 2, plausibleHigh: 3000, deltaPct: 50, decimals: 0 },
      { code: "HCT", name: "Haematocrit", unit: "%", appliesSex: "male", ageMinYears: 15, refLow: 40, refHigh: 52,
        plausibleLow: 5, plausibleHigh: 75, deltaPct: 20, decimals: 1 },
      { code: "HCT", name: "Haematocrit", unit: "%", appliesSex: "female", ageMinYears: 15, refLow: 36, refHigh: 47,
        plausibleLow: 5, plausibleHigh: 75, deltaPct: 20, decimals: 1 },
      { code: "HCT", name: "Haematocrit", unit: "%", refLow: 36, refHigh: 48,
        plausibleLow: 5, plausibleHigh: 75, deltaPct: 20, decimals: 1 },
      { code: "MCV", name: "Mean Corpuscular Volume", unit: "fL", refLow: 80, refHigh: 100,
        plausibleLow: 40, plausibleHigh: 150, decimals: 1 },
    ],
  },
  {
    code: "RFT", price: 650, name: "Renal Function Test", category: "Biochemistry", specimen: "blood", tatHours: 6,
    analytes: [
      { code: "UREA", name: "Blood Urea", unit: "mg/dL", refLow: 15, refHigh: 40, criticalHigh: 150,
        plausibleLow: 1, plausibleHigh: 400, deltaPct: 50, decimals: 0 },
      { code: "CREAT", name: "Serum Creatinine", unit: "mg/dL", appliesSex: "male", ageMinYears: 15, refLow: 0.7, refHigh: 1.3, criticalHigh: 6,
        plausibleLow: 0.1, plausibleHigh: 25, deltaAbs: 0.3, deltaPct: 40, decimals: 2 },
      { code: "CREAT", name: "Serum Creatinine", unit: "mg/dL", appliesSex: "female", ageMinYears: 15, refLow: 0.6, refHigh: 1.1, criticalHigh: 6,
        plausibleLow: 0.1, plausibleHigh: 25, deltaAbs: 0.3, deltaPct: 40, decimals: 2 },
      { code: "CREAT", name: "Serum Creatinine", unit: "mg/dL", refLow: 0.6, refHigh: 1.3, criticalHigh: 6,
        plausibleLow: 0.1, plausibleHigh: 25, deltaAbs: 0.3, deltaPct: 40, decimals: 2 },
      { code: "NA", name: "Sodium", unit: "mmol/L", refLow: 135, refHigh: 145, criticalLow: 120, criticalHigh: 160,
        plausibleLow: 90, plausibleHigh: 200, deltaAbs: 10, decimals: 0 },
      { code: "K", name: "Potassium", unit: "mmol/L", refLow: 3.5, refHigh: 5.1, criticalLow: 2.5, criticalHigh: 6.5,
        plausibleLow: 1, plausibleHigh: 10, deltaAbs: 1.5, deltaPct: 30, decimals: 1 },
    ],
  },
  {
    code: "LFT", price: 700, name: "Liver Function Test", category: "Biochemistry", specimen: "blood", tatHours: 6,
    analytes: [
      { code: "TBIL", name: "Total Bilirubin", unit: "mg/dL", refLow: 0.2, refHigh: 1.2, criticalHigh: 15,
        plausibleLow: 0, plausibleHigh: 50, deltaPct: 60, decimals: 2 },
      { code: "SGPT", name: "ALT (SGPT)", unit: "U/L", refLow: 7, refHigh: 56,
        plausibleLow: 1, plausibleHigh: 20000, deltaPct: 100, decimals: 0 },
      { code: "SGOT", name: "AST (SGOT)", unit: "U/L", refLow: 10, refHigh: 40,
        plausibleLow: 1, plausibleHigh: 20000, deltaPct: 100, decimals: 0 },
      { code: "ALB", name: "Albumin", unit: "g/dL", refLow: 3.5, refHigh: 5.2,
        plausibleLow: 0.5, plausibleHigh: 8, decimals: 1 },
    ],
  },
  {
    code: "LIPID", price: 800, name: "Lipid Profile", category: "Biochemistry", specimen: "blood", tatHours: 8,
    analytes: [
      { code: "CHOL", name: "Total Cholesterol", unit: "mg/dL", refLow: 0, refHigh: 200,
        plausibleLow: 30, plausibleHigh: 1000, decimals: 0 },
      { code: "TG", name: "Triglycerides", unit: "mg/dL", refLow: 0, refHigh: 150,
        plausibleLow: 10, plausibleHigh: 5000, decimals: 0 },
      { code: "HDL", name: "HDL Cholesterol", unit: "mg/dL", appliesSex: "male", ageMinYears: 15, refLow: 40, refHigh: 60,
        plausibleLow: 5, plausibleHigh: 200, decimals: 0 },
      { code: "HDL", name: "HDL Cholesterol", unit: "mg/dL", appliesSex: "female", ageMinYears: 15, refLow: 50, refHigh: 70,
        plausibleLow: 5, plausibleHigh: 200, decimals: 0 },
      { code: "HDL", name: "HDL Cholesterol", unit: "mg/dL", refLow: 40, refHigh: 60,
        plausibleLow: 5, plausibleHigh: 200, decimals: 0 },
      { code: "LDL", name: "LDL Cholesterol", unit: "mg/dL", refLow: 0, refHigh: 100,
        plausibleLow: 5, plausibleHigh: 600, decimals: 0 },
    ],
  },
  {
    code: "GLUC", price: 120, name: "Blood Glucose", category: "Biochemistry", specimen: "blood", tatHours: 2,
    analytes: [
      { code: "FBS", name: "Fasting Blood Sugar", unit: "mg/dL", refLow: 70, refHigh: 100, criticalLow: 40, criticalHigh: 450,
        plausibleLow: 10, plausibleHigh: 1500, deltaPct: 50, decimals: 0 },
      { code: "PPBS", name: "Post Prandial Blood Sugar", unit: "mg/dL", refLow: 70, refHigh: 140, criticalHigh: 450,
        plausibleLow: 10, plausibleHigh: 1500, deltaPct: 50, decimals: 0 },
      { code: "HBA1C", name: "HbA1c", unit: "%", refLow: 4, refHigh: 5.7,
        plausibleLow: 2, plausibleHigh: 20, deltaAbs: 2, decimals: 1 },
    ],
  },
  {
    code: "TFT", name: "Thyroid Profile", category: "Endocrinology", specimen: "blood", tatHours: 12,
    analytes: [
      { code: "TSH", name: "TSH", unit: "µIU/mL", refLow: 0.4, refHigh: 4.5 },
      { code: "T3", name: "Total T3", unit: "ng/dL", refLow: 80, refHigh: 200 },
      { code: "T4", name: "Total T4", unit: "µg/dL", refLow: 5, refHigh: 12 },
    ],
  },
  {
    code: "TROP", name: "Troponin I", category: "Cardiac", specimen: "blood", tatHours: 1,
    analytes: [{ code: "TROPI", name: "Troponin I", unit: "ng/mL", refLow: 0, refHigh: 0.04, criticalHigh: 0.5 }],
  },
  {
    code: "URINE", name: "Urine Routine", category: "Pathology", specimen: "urine", tatHours: 3,
    analytes: [
      { code: "UALB", name: "Urine Albumin", unit: "", refText: "Nil" },
      { code: "USUG", name: "Urine Sugar", unit: "", refText: "Nil" },
      { code: "UPUS", name: "Pus Cells", unit: "/hpf", refLow: 0, refHigh: 5 },
    ],
  },
];

export function seedLabCatalog(orgId: string) {
  const existing = get<{ n: number }>("SELECT COUNT(*) AS n FROM lab_tests WHERE org_id = ?", [orgId])?.n ?? 0;
  if (existing > 0) return;
  const ts = nowIso();
  for (const t of LAB_CATALOG) {
    const tid = id("ltst");
    run(
      "INSERT INTO lab_tests (id, org_id, code, name, category, specimen, tat_hours, active, created_at, price) VALUES (?,?,?,?,?,?,?,1,?,?)",
      [tid, orgId, t.code, t.name, t.category, t.specimen, t.tatHours, ts, t.price ?? 0],
    );
    t.analytes.forEach((a, i) => {
      run(
        `INSERT INTO lab_analytes
           (id, org_id, test_id, code, name, unit, ref_low, ref_high, critical_low, critical_high, ref_text, sort, created_at,
            applies_sex, age_min_years, age_max_years, plausible_low, plausible_high, delta_abs, delta_pct, decimals)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id("lana"), orgId, tid, a.code, a.name, a.unit,
          a.refLow ?? null, a.refHigh ?? null, a.criticalLow ?? null, a.criticalHigh ?? null,
          a.refText ?? "", i, ts,
          a.appliesSex ?? "any", a.ageMinYears ?? null, a.ageMaxYears ?? null,
          a.plausibleLow ?? null, a.plausibleHigh ?? null,
          a.deltaAbs ?? null, a.deltaPct ?? null, a.decimals ?? 2,
        ],
      );
    });
  }
}

/* ---------------------------- name splitting --------------------------- */

export function splitName(full: string): { firstName: string; middleName: string; lastName: string } {
  const parts = String(full ?? "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  // Drop a leading honorific so it does not become the given name.
  if (parts.length > 1 && /^(dr|mr|mrs|ms|miss|shri|smt|master|baby|b\/o)\.?$/i.test(parts[0])) parts.shift();
  if (!parts.length) return { firstName: "Unknown", middleName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], middleName: "", lastName: "" };
  if (parts.length === 2) return { firstName: parts[0], middleName: "", lastName: parts[1] };
  return { firstName: parts[0], middleName: parts.slice(1, -1).join(" "), lastName: parts[parts.length - 1] };
}

/* ------------------------------- backfill ------------------------------ */

interface LegacyPatient {
  id: string; facilityId?: string; mrn?: string; name?: string; age?: number;
  gender?: string; phone?: string; language?: string; departmentId?: string; providerId?: string;
  carePathway?: string; diagnosis?: string; allergies?: string[];
  medications?: { name: string; dose: string; frequency: string }[];
  consent?: Record<string, unknown>; status?: string; admittedAt?: string; dischargedAt?: string;
  lastContact?: string | null; risk?: string; abhaId?: string;
}

interface LegacyWard { id: string; facilityId?: string; name?: string; type?: string; floor?: number }
interface LegacyBed {
  id: string; wardId?: string; number?: string; status?: string;
  patientId?: string | null; admittedAt?: string; dailyRate?: number;
}
interface LegacyLab {
  id: string; patientId?: string; panel?: string; orderedAt?: string; status?: string;
  priority?: string; criticalFlag?: boolean; resultedAt?: string;
  tests?: { name: string; value?: string; unit?: string; range?: string; abnormal?: boolean }[];
}

/** Migrates one hospital. Safe to call repeatedly: it no-ops once patients exist. */
export function backfillOrg(orgId: string) {
  seedLabCatalog(orgId);

  const already = get<{ n: number }>("SELECT COUNT(*) AS n FROM patients WHERE org_id = ?", [orgId])?.n ?? 0;
  if (already > 0) return { migrated: false as const };

  const legacyPatients = records.list<LegacyPatient>(orgId, "patient");
  const legacyWards = records.list<LegacyWard>(orgId, "ward");
  const legacyBeds = records.list<LegacyBed>(orgId, "bed");
  const legacyLabs = records.list<LegacyLab>(orgId, "labOrder");
  if (!legacyPatients.length && !legacyWards.length) return { migrated: false as const };

  const ts = nowIso();
  const system = "migration";

  tx(() => {
    /* -------------------------- patients ------------------------------ */
    let uhidMax = 0;
    for (const p of legacyPatients) {
      const { firstName, middleName, lastName } = splitName(p.name ?? "");
      const age = Number(p.age) || 0;
      // Legacy rows carry an age, not a date of birth. We derive a DOB so the
      // rest of the system has one source of truth, and flag it as estimated.
      const dob = age > 0 ? dobFromAge(age) : null;
      const uhid = (p.mrn ?? "").toUpperCase() || `UH${new Date().getFullYear()}${String(++uhidMax).padStart(6, "0")}`;
      const m = /(\d{4,})$/.exec(uhid);
      if (m) uhidMax = Math.max(uhidMax, Number(m[1]));

      run(
        `INSERT OR IGNORE INTO patients (
           id, org_id, uhid, first_name, middle_name, last_name, date_of_birth, age_years, dob_estimated,
           gender, mobile, preferred_language, facility_id, department_id, provider_id,
           care_pathway, risk, consent, abha_id, status, source, last_contact,
           created_by, updated_by, version, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active', 'legacy', ?,?,?,1,?,?)`,
        [
          p.id, orgId, uhid, firstName, middleName, lastName, dob, age || null, dob ? 1 : 0,
          p.gender === "M" ? "male" : p.gender === "F" ? "female" : p.gender === "O" ? "other" : "unknown",
          normalizeMobile(p.phone), p.language ?? "en",
          p.facilityId ?? null, p.departmentId ?? null, p.providerId ?? null,
          p.carePathway ?? "", p.risk ?? "low", JSON.stringify(p.consent ?? {}), p.abhaId ?? null,
          p.lastContact ?? null, system, system, ts, ts,
        ],
      );

      for (const a of p.allergies ?? []) {
        run(
          `INSERT INTO patient_allergies (id, org_id, patient_id, substance, category, reaction, severity, status, recorded_by, recorded_at, created_at, updated_at)
           VALUES (?,?,?,?, 'medication', '', 'moderate', 'active', ?,?,?,?)`,
          [id("alg"), orgId, p.id, a, system, ts, ts, ts],
        );
      }

      for (const med of p.medications ?? []) {
        run(
          `INSERT INTO medication_orders
             (id, org_id, patient_id, medicine, dose, route, frequency, status, prescribed_by, prescribed_at, created_at, updated_at)
           VALUES (?,?,?,?,?, 'oral', ?, 'ACTIVE', ?,?,?,?)`,
          [id("med"), orgId, p.id, med.name, med.dose ?? "", med.frequency ?? "", system, ts, ts, ts],
        );
      }

      if (p.diagnosis) {
        run(
          `INSERT INTO diagnoses (id, org_id, patient_id, code_system, code, description, category, rank, status, recorded_by, recorded_at, created_at, updated_at)
           VALUES (?,?,?, 'free-text', '', ?, 'final', 'primary', 'active', ?,?,?,?)`,
          [id("dx"), orgId, p.id, p.diagnosis, system, ts, ts, ts],
        );
      }

      run(
        `INSERT INTO patient_events (id, org_id, patient_id, at, kind, title, detail, entity_type, entity_id, actor, severity, created_at)
         VALUES (?,?,?,?, 'registration', 'Registered', ?, 'patient', ?, ?, 'info', ?)`,
        [id("evt"), orgId, p.id, ts, `UHID ${uhid}`, p.id, system, ts],
      );
    }
    if (uhidMax) seedCounter(orgId, "uhid", uhidMax);

    /* ---------------------------- wards ------------------------------- */
    for (const w of legacyWards) {
      run(
        "INSERT OR IGNORE INTO wards (id, org_id, facility_id, name, type, floor, active, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,?)",
        [w.id, orgId, w.facilityId ?? null, w.name ?? "Ward", w.type ?? "general", Number(w.floor) || 0, ts, ts],
      );
    }

    /* ----------------------------- beds ------------------------------- */
    const wardIds = new Set(legacyWards.map((w) => w.id));
    for (const b of legacyBeds) {
      if (!b.wardId || !wardIds.has(b.wardId)) continue;
      const status = (b.status ?? "available").toUpperCase();
      run(
        "INSERT OR IGNORE INTO beds (id, org_id, ward_id, number, status, daily_rate, active, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,?)",
        [
          b.id, orgId, b.wardId, b.number ?? "?",
          ["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING", "MAINTENANCE", "BLOCKED"].includes(status) ? status : "AVAILABLE",
          Number(b.dailyRate) || 0, ts, ts,
        ],
      );
    }

    /* ----------- admissions reconstructed from occupied beds ----------- */
    let admissionNo = 0;
    const patientIds = new Set(legacyPatients.map((p) => p.id));
    /**
     * The legacy store allowed the same patient to appear in two beds at once —
     * the exact corruption the new unique indexes forbid. Reconcile it here
     * instead of aborting: the first bed wins, later ones are left free and the
     * conflict is recorded on the patient's timeline so it is visible, not lost.
     */
    const admitted = new Set<string>();
    for (const b of legacyBeds) {
      if (!b.patientId || !patientIds.has(b.patientId) || !b.wardId || !wardIds.has(b.wardId)) continue;
      if (admitted.has(b.patientId)) {
        run("UPDATE beds SET status = 'AVAILABLE', note = ? WHERE org_id = ? AND id = ?", [
          "Released during migration: the legacy data had this patient in two beds at once", orgId, b.id,
        ]);
        run(
          `INSERT INTO patient_events (id, org_id, patient_id, at, kind, title, detail, entity_type, entity_id, actor, severity, created_at)
           VALUES (?,?,?,?, 'note', 'Migration conflict resolved', ?, 'bed', ?, ?, 'warning', ?)`,
          [
            id("evt"), orgId, b.patientId, ts,
            `Legacy data showed this patient in more than one bed. Bed ${b.number ?? b.id} was released; the earlier assignment was kept.`,
            b.id, system, ts,
          ],
        );
        continue;
      }
      admitted.add(b.patientId);
      const legacy = legacyPatients.find((p) => p.id === b.patientId);
      const admittedAt = b.admittedAt ?? legacy?.admittedAt ?? ts;
      const admissionId = id("adm");
      const no = `IP${new Date().getFullYear()}${String(++admissionNo).padStart(5, "0")}`;

      run(
        `INSERT INTO admissions (id, org_id, patient_id, admission_no, type, status, facility_id, department_id, provider_id,
           admitted_at, reason, created_by, created_at, updated_at)
         VALUES (?,?,?,?, 'elective', 'ACTIVE', ?,?,?,?,?,?,?,?)`,
        [
          admissionId, orgId, b.patientId, no, legacy?.facilityId ?? null,
          legacy?.departmentId ?? null, legacy?.providerId ?? null, admittedAt,
          legacy?.diagnosis ?? "", system, ts, ts,
        ],
      );
      run(
        `INSERT INTO ward_assignments (id, org_id, admission_id, patient_id, ward_id, bed_id, status, from_at, reason, assigned_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?, 'ACTIVE', ?, 'migrated from legacy bed occupancy', ?,?,?)`,
        [id("wasg"), orgId, admissionId, b.patientId, b.wardId, b.id, admittedAt, system, ts, ts],
      );
      run("UPDATE beds SET status = 'OCCUPIED' WHERE org_id = ? AND id = ?", [orgId, b.id]);
      run(
        `INSERT INTO patient_events (id, org_id, patient_id, at, kind, title, detail, entity_type, entity_id, actor, severity, created_at)
         VALUES (?,?,?,?, 'admission', ?, ?, 'admission', ?, ?, 'info', ?)`,
        [id("evt"), orgId, b.patientId, admittedAt, `Admitted — ${no}`, `bed ${b.number ?? ""}`, admissionId, system, ts],
      );
    }
    if (admissionNo) seedCounter(orgId, "admission", admissionNo);

    /* --------------------------- lab orders --------------------------- */
    const tests = all<{ id: string; code: string; name: string }>(
      "SELECT id, code, name FROM lab_tests WHERE org_id = ?", [orgId],
    );
    const analytes = all<{ id: string; test_id: string; code: string; name: string; unit: string; ref_low: number | null; ref_high: number | null }>(
      "SELECT * FROM lab_analytes WHERE org_id = ?", [orgId],
    );
    const analyteByName = new Map(analytes.map((a) => [a.name.toLowerCase(), a]));

    let labNo = 0;
    for (const l of legacyLabs) {
      if (!l.patientId || !patientIds.has(l.patientId)) continue;
      const orderId = l.id;
      const no = `LAB${new Date().getFullYear()}${String(++labNo).padStart(5, "0")}`;
      const legacyStatus = (l.status ?? "ordered").toLowerCase();
      const status =
        legacyStatus === "verified" ? "VERIFIED"
        : legacyStatus === "resulted" ? "RESULT_ENTERED"
        : legacyStatus === "processing" ? "PROCESSING"
        : legacyStatus === "collected" ? "SAMPLE_COLLECTED"
        : "ORDERED";

      run(
        `INSERT OR IGNORE INTO lab_orders (id, org_id, patient_id, order_no, status, priority, ordered_by, ordered_at,
           specimen, collected_at, entered_at, verified_at, critical, created_at, updated_at)
         VALUES (?,?,?,?,?,?, ?,?, 'blood', ?,?,?,?,?,?)`,
        [
          orderId, orgId, l.patientId, no, status, l.priority ?? "routine", system,
          l.orderedAt ?? ts,
          status !== "ORDERED" ? (l.orderedAt ?? ts) : null,
          l.resultedAt ?? null,
          status === "VERIFIED" ? (l.resultedAt ?? ts) : null,
          l.criticalFlag ? 1 : 0, ts, ts,
        ],
      );

      // Map the legacy panel name to a catalogue test where we can.
      const panel = (l.panel ?? "").toLowerCase();
      const matched = tests.find((t) => panel.includes(t.name.toLowerCase()) || panel.includes(t.code.toLowerCase()))
        ?? tests.find((t) => t.code === "CBC");
      const itemId = id("litm");
      if (matched) {
        run(
          "INSERT INTO lab_order_items (id, org_id, order_id, test_id, test_code, test_name, created_at) VALUES (?,?,?,?,?,?,?)",
          [itemId, orgId, orderId, matched.id, matched.code, l.panel ?? matched.name, ts],
        );
      }

      for (const t of l.tests ?? []) {
        const def = analyteByName.get((t.name ?? "").toLowerCase());
        const valueNum = Number(String(t.value ?? "").replace(/[^0-9.\-]/g, ""));
        const numeric = Number.isFinite(valueNum) ? valueNum : null;
        let flag = "NORMAL";
        if (def && numeric !== null) {
          if (def.ref_low !== null && numeric < def.ref_low) flag = "LOW";
          else if (def.ref_high !== null && numeric > def.ref_high) flag = "HIGH";
        } else if (t.abnormal) flag = "ABNORMAL";

        run(
          `INSERT INTO lab_results (id, org_id, order_id, item_id, analyte_id, analyte_code, analyte_name,
             value_text, value_num, unit, ref_low, ref_high, ref_text, flag, status, version, entered_by, entered_at, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`,
          [
            id("lres"), orgId, orderId, itemId, def?.id ?? null, def?.code ?? (t.name ?? "").slice(0, 20).toUpperCase(),
            t.name ?? "", String(t.value ?? ""), numeric, t.unit ?? def?.unit ?? "",
            def?.ref_low ?? null, def?.ref_high ?? null, t.range ?? "", flag,
            status === "VERIFIED" ? "FINAL" : "PRELIMINARY", system, l.resultedAt ?? null, ts, ts,
          ],
        );
      }

      run(
        `INSERT INTO patient_events (id, org_id, patient_id, at, kind, title, detail, entity_type, entity_id, actor, severity, created_at)
         VALUES (?,?,?,?, 'lab_order', ?, ?, 'lab_order', ?, ?, ?, ?)`,
        [
          id("evt"), orgId, l.patientId, l.orderedAt ?? ts, `Lab ordered — ${l.panel ?? "Panel"}`,
          no, orderId, system, l.criticalFlag ? "critical" : "info", ts,
        ],
      );
    }
    if (labNo) seedCounter(orgId, "laborder", labNo);
  });

  return { migrated: true as const, patients: legacyPatients.length, beds: legacyBeds.length, labs: legacyLabs.length };
}

/** Migrates every hospital that has not been migrated yet. */
export function backfillAll() {
  const orgs = all<{ id: string }>("SELECT id FROM organizations");
  const out: Record<string, unknown> = {};
  for (const o of orgs) {
    try {
      out[o.id] = backfillOrg(o.id);
    } catch (e) {
      out[o.id] = { error: e instanceof Error ? e.message : String(e) };
      console.error("[backfill]", o.id, e);
    }
  }
  return out;
}

/** Derived age helper kept here so migration and API agree on one definition. */
export { ageFromDob };
