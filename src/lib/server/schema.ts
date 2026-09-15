/**
 * Clinical domain schema.
 *
 * The original build stored every clinical entity as a JSON blob in one generic
 * `records` table. That made Patient, Ward, Lab and Medical Records behave like
 * unrelated CRUD pages: a bed carried a patientId, a patient carried an age and
 * an embedded medication array, and a lab order was a single document with no
 * lifecycle. This module introduces the real relational core:
 *
 *   Hospital → Patient → Encounter / Admission → Clinical records
 *                                              → Laboratory
 *                                              → Medication
 *                                              → Ward / Bed
 *                                              → Billing → Discharge
 *
 * Every table is tenant-scoped by `org_id`, and the tenant is always resolved
 * from the server session — never from the request body.
 *
 * Two invariants are enforced by the database itself rather than by application
 * code, because application code loses races:
 *   - `ward_assign_one_active_bed`  : one active assignment per bed
 *   - `admissions_one_active`       : one active admission per patient
 */

import type { DatabaseSync } from "node:sqlite";

export function migrateClinical(conn: DatabaseSync) {
  conn.exec(`
    /* ------------------------------------------------------------------ */
    /* Patient master — one permanent identity per hospital                */
    /* ------------------------------------------------------------------ */
    CREATE TABLE IF NOT EXISTS patients (
      id                 TEXT PRIMARY KEY,
      org_id             TEXT NOT NULL,
      uhid               TEXT NOT NULL,
      external_id        TEXT,
      first_name         TEXT NOT NULL,
      middle_name        TEXT NOT NULL DEFAULT '',
      last_name          TEXT NOT NULL DEFAULT '',
      date_of_birth      TEXT,
      age_years          INTEGER,
      dob_estimated      INTEGER NOT NULL DEFAULT 0,
      gender             TEXT NOT NULL DEFAULT 'unknown',
      mobile             TEXT NOT NULL DEFAULT '',
      alt_mobile         TEXT NOT NULL DEFAULT '',
      email              TEXT NOT NULL DEFAULT '',
      blood_group        TEXT,
      preferred_language TEXT NOT NULL DEFAULT 'en',
      address_line       TEXT NOT NULL DEFAULT '',
      village            TEXT NOT NULL DEFAULT '',
      taluka             TEXT NOT NULL DEFAULT '',
      district           TEXT NOT NULL DEFAULT '',
      state              TEXT NOT NULL DEFAULT '',
      pin                TEXT NOT NULL DEFAULT '',
      emergency_name     TEXT NOT NULL DEFAULT '',
      emergency_relation TEXT NOT NULL DEFAULT '',
      emergency_mobile   TEXT NOT NULL DEFAULT '',
      abha_id            TEXT,
      insurance_provider TEXT NOT NULL DEFAULT '',
      insurance_number   TEXT NOT NULL DEFAULT '',
      status             TEXT NOT NULL DEFAULT 'active',
      deceased_at        TEXT,
      merged_into        TEXT,
      facility_id        TEXT,
      department_id      TEXT,
      provider_id        TEXT,
      care_pathway       TEXT NOT NULL DEFAULT '',
      risk               TEXT NOT NULL DEFAULT 'green',
      consent            TEXT NOT NULL DEFAULT '{}',
      source             TEXT NOT NULL DEFAULT 'manual',
      import_batch_id    TEXT,
      last_contact       TEXT,
      created_by         TEXT,
      updated_by         TEXT,
      version            INTEGER NOT NULL DEFAULT 1,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS patients_uhid       ON patients (org_id, uhid);
    CREATE INDEX        IF NOT EXISTS patients_org_name   ON patients (org_id, last_name, first_name);
    CREATE INDEX        IF NOT EXISTS patients_org_mobile ON patients (org_id, mobile);
    CREATE INDEX        IF NOT EXISTS patients_org_status ON patients (org_id, status);
    /*
     * Duplicate detection matches on name *and* date of birth. The name half
     * is case-folded, so no index can serve it — but date of birth is highly
     * selective, and indexing it turns a full scan of the register into a
     * handful of rows to compare. Without this, importing 500 patients into a
     * hospital of 8,000 evaluated four million rows and took long enough that
     * the import appeared to hang.
     */
    CREATE INDEX        IF NOT EXISTS patients_org_dob    ON patients (org_id, date_of_birth);
    CREATE UNIQUE INDEX IF NOT EXISTS patients_external
      ON patients (org_id, external_id) WHERE external_id IS NOT NULL AND external_id <> '';

    CREATE TABLE IF NOT EXISTS patient_allergies (
      id           TEXT PRIMARY KEY,
      org_id       TEXT NOT NULL,
      patient_id   TEXT NOT NULL,
      substance    TEXT NOT NULL,
      category     TEXT NOT NULL DEFAULT 'medication',
      reaction     TEXT NOT NULL DEFAULT '',
      severity     TEXT NOT NULL DEFAULT 'moderate',
      status       TEXT NOT NULL DEFAULT 'active',
      onset_date   TEXT,
      note         TEXT NOT NULL DEFAULT '',
      recorded_by  TEXT NOT NULL DEFAULT '',
      recorded_at  TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS allergies_patient ON patient_allergies (org_id, patient_id, status);

    /* ------------------------------------------------------------------ */
    /* Ward hierarchy: Hospital → Building → Floor → Ward → Room → Bed     */
    /* ------------------------------------------------------------------ */
    CREATE TABLE IF NOT EXISTS buildings (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, facility_id TEXT,
      name TEXT NOT NULL, created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wards (
      id          TEXT PRIMARY KEY,
      org_id      TEXT NOT NULL,
      facility_id TEXT,
      building_id TEXT,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL DEFAULT 'general',
      floor       INTEGER NOT NULL DEFAULT 0,
      gender_policy TEXT NOT NULL DEFAULT 'any',
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS wards_org ON wards (org_id, active);

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, ward_id TEXT NOT NULL,
      name TEXT NOT NULL, room_type TEXT NOT NULL DEFAULT 'general',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rooms_ward ON rooms (org_id, ward_id);

    CREATE TABLE IF NOT EXISTS beds (
      id         TEXT PRIMARY KEY,
      org_id     TEXT NOT NULL,
      ward_id    TEXT NOT NULL,
      room_id    TEXT,
      number     TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'AVAILABLE',
      daily_rate INTEGER NOT NULL DEFAULT 0,
      active     INTEGER NOT NULL DEFAULT 1,
      note       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (status IN ('AVAILABLE','OCCUPIED','RESERVED','CLEANING','MAINTENANCE','BLOCKED'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS beds_ward_number ON beds (org_id, ward_id, number);
    CREATE INDEX        IF NOT EXISTS beds_org_status  ON beds (org_id, status);

    /* ------------------------------------------------------------------ */
    /* Admissions and ward assignments                                     */
    /* ------------------------------------------------------------------ */
    CREATE TABLE IF NOT EXISTS admissions (
      id                     TEXT PRIMARY KEY,
      org_id                 TEXT NOT NULL,
      patient_id             TEXT NOT NULL,
      admission_no           TEXT NOT NULL,
      external_admission_id  TEXT,
      type                   TEXT NOT NULL DEFAULT 'elective',
      status                 TEXT NOT NULL DEFAULT 'ACTIVE',
      facility_id            TEXT,
      department_id          TEXT,
      provider_id            TEXT,
      admitted_at            TEXT NOT NULL,
      discharged_at          TEXT,
      reason                 TEXT NOT NULL DEFAULT '',
      referred_by            TEXT NOT NULL DEFAULT '',
      discharge_type         TEXT,
      final_diagnosis        TEXT,
      discharge_summary      TEXT,
      discharge_instructions TEXT,
      discharge_procedures   TEXT,
      discharge_doctor_id    TEXT,
      discharge_followup_date TEXT,
      import_batch_id        TEXT,
      created_by             TEXT,
      created_at             TEXT NOT NULL,
      updated_at             TEXT NOT NULL,
      CHECK (status IN ('ACTIVE','DISCHARGED','CANCELLED','LAMA','ABSCONDED','EXPIRED'))
    );
    CREATE INDEX IF NOT EXISTS admissions_patient ON admissions (org_id, patient_id, admitted_at DESC);
    CREATE INDEX IF NOT EXISTS admissions_status  ON admissions (org_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS admissions_no ON admissions (org_id, admission_no);
    /* One active admission per patient — enforced by the database, not by a check-then-write. */
    CREATE UNIQUE INDEX IF NOT EXISTS admissions_one_active
      ON admissions (org_id, patient_id) WHERE status = 'ACTIVE';

    CREATE TABLE IF NOT EXISTS ward_assignments (
      id             TEXT PRIMARY KEY,
      org_id         TEXT NOT NULL,
      admission_id   TEXT NOT NULL,
      patient_id     TEXT NOT NULL,
      ward_id        TEXT NOT NULL,
      room_id        TEXT,
      bed_id         TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'ACTIVE',
      from_at        TEXT NOT NULL,
      to_at          TEXT,
      reason         TEXT NOT NULL DEFAULT '',
      transfer_reason TEXT NOT NULL DEFAULT '',
      authorized_by  TEXT NOT NULL DEFAULT '',
      assigned_by    TEXT NOT NULL DEFAULT '',
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      CHECK (status IN ('ACTIVE','CLOSED'))
    );
    /* A bed can never hold two active assignments. */
    CREATE UNIQUE INDEX IF NOT EXISTS ward_assign_one_active_bed
      ON ward_assignments (org_id, bed_id) WHERE status = 'ACTIVE';
    /* An admission can never occupy two beds at once. */
    CREATE UNIQUE INDEX IF NOT EXISTS ward_assign_one_active_adm
      ON ward_assignments (org_id, admission_id) WHERE status = 'ACTIVE';
    CREATE INDEX IF NOT EXISTS ward_assign_patient ON ward_assignments (org_id, patient_id, from_at DESC);

    /* ------------------------------------------------------------------ */
    /* Encounters — the clinical visit record                              */
    /* ------------------------------------------------------------------ */
    CREATE TABLE IF NOT EXISTS encounters (
      id                TEXT PRIMARY KEY,
      org_id            TEXT NOT NULL,
      patient_id        TEXT NOT NULL,
      encounter_no      TEXT NOT NULL,
      type              TEXT NOT NULL DEFAULT 'opd',
      status            TEXT NOT NULL DEFAULT 'in_progress',
      facility_id       TEXT,
      department_id     TEXT,
      provider_id       TEXT,
      admission_id      TEXT,
      appointment_id    TEXT,
      started_at        TEXT NOT NULL,
      ended_at          TEXT,
      chief_complaint   TEXT NOT NULL DEFAULT '',
      hpi               TEXT NOT NULL DEFAULT '',
      past_history      TEXT NOT NULL DEFAULT '',
      family_history    TEXT NOT NULL DEFAULT '',
      examination       TEXT NOT NULL DEFAULT '',
      assessment        TEXT NOT NULL DEFAULT '',
      plan              TEXT NOT NULL DEFAULT '',
      notes             TEXT NOT NULL DEFAULT '',
      procedures        TEXT NOT NULL DEFAULT '',
      followup_date     TEXT,
      followup_instructions TEXT NOT NULL DEFAULT '',
      version           INTEGER NOT NULL DEFAULT 1,
      signed_by         TEXT,
      signed_at         TEXT,
      created_by        TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      CHECK (status IN ('planned','in_progress','completed','cancelled','entered_in_error'))
    );
    CREATE INDEX IF NOT EXISTS encounters_patient ON encounters (org_id, patient_id, started_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS encounters_no ON encounters (org_id, encounter_no);

    CREATE TABLE IF NOT EXISTS encounter_versions (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, encounter_id TEXT NOT NULL,
      version INTEGER NOT NULL, snapshot TEXT NOT NULL,
      changed_by TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS encounter_versions_enc ON encounter_versions (org_id, encounter_id, version DESC);

    /* ------------------------------------------------------------------ */
    /* Vitals — a time series, never columns on the patient                */
    /* ------------------------------------------------------------------ */
    CREATE TABLE IF NOT EXISTS vitals (
      id               TEXT PRIMARY KEY,
      org_id           TEXT NOT NULL,
      patient_id       TEXT NOT NULL,
      encounter_id     TEXT,
      admission_id     TEXT,
      recorded_at      TEXT NOT NULL,
      recorded_by      TEXT NOT NULL DEFAULT '',
      temperature_c    REAL,
      systolic         INTEGER,
      diastolic        INTEGER,
      pulse            INTEGER,
      respiratory_rate INTEGER,
      spo2             INTEGER,
      height_cm        REAL,
      weight_kg        REAL,
      blood_glucose    REAL,
      pain_score       INTEGER,
      note             TEXT NOT NULL DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'final',
      created_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS vitals_patient ON vitals (org_id, patient_id, recorded_at DESC);

    /* ------------------------------------------------------------------ */
    /* Diagnoses                                                           */
    /* ------------------------------------------------------------------ */
    CREATE TABLE IF NOT EXISTS diagnoses (
      id           TEXT PRIMARY KEY,
      org_id       TEXT NOT NULL,
      patient_id   TEXT NOT NULL,
      encounter_id TEXT,
      admission_id TEXT,
      code_system  TEXT NOT NULL DEFAULT 'free-text',
      code         TEXT NOT NULL DEFAULT '',
      description  TEXT NOT NULL,
      category     TEXT NOT NULL DEFAULT 'provisional',
      rank         TEXT NOT NULL DEFAULT 'secondary',
      status       TEXT NOT NULL DEFAULT 'active',
      onset_date   TEXT,
      recorded_by  TEXT NOT NULL DEFAULT '',
      recorded_at  TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      CHECK (status IN ('active','resolved','entered_in_error'))
    );
    CREATE INDEX IF NOT EXISTS diagnoses_patient ON diagnoses (org_id, patient_id, recorded_at DESC);

    /* ------------------------------------------------------------------ */
    /* Medication orders — structured, never free text                     */
    /* ------------------------------------------------------------------ */
    CREATE TABLE IF NOT EXISTS medication_orders (
      id             TEXT PRIMARY KEY,
      org_id         TEXT NOT NULL,
      patient_id     TEXT NOT NULL,
      encounter_id   TEXT,
      admission_id   TEXT,
      drug_id        TEXT,
      medicine       TEXT NOT NULL,
      generic_name   TEXT NOT NULL DEFAULT '',
      strength       TEXT NOT NULL DEFAULT '',
      form           TEXT NOT NULL DEFAULT '',
      dose           TEXT NOT NULL DEFAULT '',
      route          TEXT NOT NULL DEFAULT 'oral',
      frequency      TEXT NOT NULL DEFAULT '',
      timing         TEXT NOT NULL DEFAULT '',
      prn            INTEGER NOT NULL DEFAULT 0,
      duration_days  INTEGER,
      start_date     TEXT,
      end_date       TEXT,
      instructions   TEXT NOT NULL DEFAULT '',
      status         TEXT NOT NULL DEFAULT 'ACTIVE',
      stopped_reason TEXT NOT NULL DEFAULT '',
      allergy_warning TEXT NOT NULL DEFAULT '',
      allergy_override_reason TEXT NOT NULL DEFAULT '',
      prescribed_by  TEXT NOT NULL DEFAULT '',
      prescribed_at  TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      CHECK (status IN ('ACTIVE','COMPLETED','STOPPED','CANCELLED','ENTERED_IN_ERROR'))
    );
    CREATE INDEX IF NOT EXISTS meds_patient ON medication_orders (org_id, patient_id, prescribed_at DESC);

    /* ------------------------------------------------------------------ */
    /* Laboratory                                                          */
    /* ------------------------------------------------------------------ */
    CREATE TABLE IF NOT EXISTS lab_tests (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general', specimen TEXT NOT NULL DEFAULT 'blood',
      tat_hours INTEGER NOT NULL DEFAULT 24, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS lab_tests_code ON lab_tests (org_id, code);

    CREATE TABLE IF NOT EXISTS lab_analytes (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, test_id TEXT NOT NULL,
      code TEXT NOT NULL, name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '',
      ref_low REAL, ref_high REAL, critical_low REAL, critical_high REAL,
      ref_text TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS lab_analytes_test ON lab_analytes (org_id, test_id, sort);

    CREATE TABLE IF NOT EXISTS lab_orders (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      patient_id    TEXT NOT NULL,
      encounter_id  TEXT,
      admission_id  TEXT,
      order_no      TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ORDERED',
      priority      TEXT NOT NULL DEFAULT 'routine',
      clinical_note TEXT NOT NULL DEFAULT '',
      ordered_by    TEXT NOT NULL DEFAULT '',
      ordered_by_id TEXT,
      ordered_at    TEXT NOT NULL,
      specimen      TEXT NOT NULL DEFAULT '',
      sample_id     TEXT,
      collected_by  TEXT, collected_at TEXT,
      processing_started_at TEXT,
      entered_by    TEXT, entered_at TEXT,
      verified_by   TEXT, verified_by_id TEXT, verified_at TEXT,
      released_at   TEXT,
      cancelled_by  TEXT, cancelled_at TEXT, cancel_reason TEXT,
      critical      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      CHECK (status IN ('ORDERED','SAMPLE_COLLECTED','PROCESSING','RESULT_ENTERED','VERIFIED','RELEASED','CANCELLED'))
    );
    CREATE INDEX IF NOT EXISTS lab_orders_patient ON lab_orders (org_id, patient_id, ordered_at DESC);
    CREATE INDEX IF NOT EXISTS lab_orders_status  ON lab_orders (org_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS lab_orders_no ON lab_orders (org_id, order_no);

    CREATE TABLE IF NOT EXISTS lab_order_items (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, order_id TEXT NOT NULL,
      test_id TEXT, test_code TEXT NOT NULL, test_name TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS lab_items_order ON lab_order_items (org_id, order_id);

    CREATE TABLE IF NOT EXISTS lab_results (
      id           TEXT PRIMARY KEY,
      org_id       TEXT NOT NULL,
      order_id     TEXT NOT NULL,
      item_id      TEXT NOT NULL,
      analyte_id   TEXT,
      analyte_code TEXT NOT NULL,
      analyte_name TEXT NOT NULL,
      value_text   TEXT NOT NULL DEFAULT '',
      value_num    REAL,
      unit         TEXT NOT NULL DEFAULT '',
      ref_low      REAL, ref_high REAL, ref_text TEXT NOT NULL DEFAULT '',
      flag         TEXT NOT NULL DEFAULT 'NORMAL',
      status       TEXT NOT NULL DEFAULT 'PRELIMINARY',
      version      INTEGER NOT NULL DEFAULT 1,
      entered_by   TEXT NOT NULL DEFAULT '', entered_at TEXT,
      verified_by  TEXT NOT NULL DEFAULT '', verified_at TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      CHECK (flag   IN ('NORMAL','LOW','HIGH','CRITICAL_LOW','CRITICAL_HIGH','ABNORMAL')),
      CHECK (status IN ('PRELIMINARY','FINAL','AMENDED','ENTERED_IN_ERROR'))
    );
    CREATE INDEX IF NOT EXISTS lab_results_order ON lab_results (org_id, order_id);

    CREATE TABLE IF NOT EXISTS lab_result_versions (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, result_id TEXT NOT NULL,
      version INTEGER NOT NULL, snapshot TEXT NOT NULL,
      changed_by TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS lab_versions_result ON lab_result_versions (org_id, result_id, version DESC);

    CREATE TABLE IF NOT EXISTS critical_notifications (
      id             TEXT PRIMARY KEY,
      org_id         TEXT NOT NULL,
      patient_id     TEXT NOT NULL,
      order_id       TEXT NOT NULL,
      result_id      TEXT NOT NULL,
      analyte_name   TEXT NOT NULL,
      value_text     TEXT NOT NULL DEFAULT '',
      flag           TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'PENDING',
      detected_at    TEXT NOT NULL,
      notified_at    TEXT,
      notified_to    TEXT NOT NULL DEFAULT '',
      channel        TEXT NOT NULL DEFAULT '',
      acknowledged_at TEXT,
      acknowledged_by TEXT NOT NULL DEFAULT '',
      note           TEXT NOT NULL DEFAULT '',
      created_at     TEXT NOT NULL,
      CHECK (status IN ('PENDING','NOTIFIED','ACKNOWLEDGED'))
    );
    CREATE INDEX IF NOT EXISTS crit_notif_org ON critical_notifications (org_id, status, detected_at DESC);

    /* ------------------------------------------------------------------ */
    /* Documents                                                           */
    /* ------------------------------------------------------------------ */
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, patient_id TEXT NOT NULL,
      encounter_id TEXT, admission_id TEXT,
      title TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'other',
      mime TEXT NOT NULL DEFAULT 'application/octet-stream',
      storage_key TEXT NOT NULL DEFAULT '', bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      uploaded_by TEXT NOT NULL DEFAULT '', uploaded_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS documents_patient ON documents (org_id, patient_id, uploaded_at DESC);

    /* ------------------------------------------------------------------ */
    /* Unified patient timeline                                            */
    /* ------------------------------------------------------------------ */
    CREATE TABLE IF NOT EXISTS patient_events (
      id          TEXT PRIMARY KEY,
      org_id      TEXT NOT NULL,
      patient_id  TEXT NOT NULL,
      at          TEXT NOT NULL,
      kind        TEXT NOT NULL,
      title       TEXT NOT NULL,
      detail      TEXT NOT NULL DEFAULT '',
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id   TEXT NOT NULL DEFAULT '',
      actor       TEXT NOT NULL DEFAULT '',
      severity    TEXT NOT NULL DEFAULT 'info',
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_patient ON patient_events (org_id, patient_id, at DESC);

    /* ------------------------------------------------------------------ */
    /* Clinical audit — before/after, never destructive                    */
    /* ------------------------------------------------------------------ */
    CREATE TABLE IF NOT EXISTS clinical_audit (
      id          TEXT PRIMARY KEY,
      org_id      TEXT NOT NULL,
      patient_id  TEXT,
      actor_id    TEXT NOT NULL DEFAULT '',
      actor_name  TEXT NOT NULL DEFAULT '',
      actor_role  TEXT NOT NULL DEFAULT '',
      entity_type TEXT NOT NULL,
      entity_id   TEXT NOT NULL,
      action      TEXT NOT NULL,
      reason      TEXT NOT NULL DEFAULT '',
      before      TEXT,
      after       TEXT,
      at          TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS caudit_patient ON clinical_audit (org_id, patient_id, at DESC);
    CREATE INDEX IF NOT EXISTS caudit_entity  ON clinical_audit (org_id, entity_type, entity_id);

    /* ------------------------------------------------------------------ */
    /* Bulk import                                                         */
    /* ------------------------------------------------------------------ */
    CREATE TABLE IF NOT EXISTS import_batches (
      id                TEXT PRIMARY KEY,
      org_id            TEXT NOT NULL,
      uploaded_by       TEXT NOT NULL DEFAULT '',
      uploaded_by_name  TEXT NOT NULL DEFAULT '',
      uploaded_at       TEXT NOT NULL,
      filename          TEXT NOT NULL DEFAULT '',
      bytes             INTEGER NOT NULL DEFAULT 0,
      status            TEXT NOT NULL DEFAULT 'PREVIEW',
      mapping           TEXT NOT NULL DEFAULT '{}',
      detected_headers  TEXT NOT NULL DEFAULT '{}',
      options           TEXT NOT NULL DEFAULT '{}',
      total_rows        INTEGER NOT NULL DEFAULT 0,
      valid_rows        INTEGER NOT NULL DEFAULT 0,
      invalid_rows      INTEGER NOT NULL DEFAULT 0,
      duplicate_rows    INTEGER NOT NULL DEFAULT 0,
      warning_rows      INTEGER NOT NULL DEFAULT 0,
      created_count     INTEGER NOT NULL DEFAULT 0,
      updated_count     INTEGER NOT NULL DEFAULT 0,
      skipped_count     INTEGER NOT NULL DEFAULT 0,
      failed_count      INTEGER NOT NULL DEFAULT 0,
      admissions_total  INTEGER NOT NULL DEFAULT 0,
      admissions_created INTEGER NOT NULL DEFAULT 0,
      admissions_failed INTEGER NOT NULL DEFAULT 0,
      committed_at      TEXT,
      error             TEXT,
      CHECK (status IN ('PREVIEW','COMMITTED','PARTIAL','CANCELLED','FAILED'))
    );
    CREATE INDEX IF NOT EXISTS import_batches_org ON import_batches (org_id, uploaded_at DESC);

    CREATE TABLE IF NOT EXISTS import_rows (
      id               TEXT PRIMARY KEY,
      org_id           TEXT NOT NULL,
      batch_id         TEXT NOT NULL,
      sheet            TEXT NOT NULL DEFAULT 'PATIENTS',
      row_no           INTEGER NOT NULL,
      raw              TEXT NOT NULL DEFAULT '{}',
      normalized       TEXT NOT NULL DEFAULT '{}',
      status           TEXT NOT NULL DEFAULT 'VALID',
      action           TEXT NOT NULL DEFAULT 'create',
      match_patient_id TEXT,
      match_reason     TEXT NOT NULL DEFAULT '',
      match_strength   TEXT NOT NULL DEFAULT '',
      errors           TEXT NOT NULL DEFAULT '[]',
      warnings         TEXT NOT NULL DEFAULT '[]',
      conflicts        TEXT NOT NULL DEFAULT '[]',
      result_id        TEXT,
      result_message   TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS import_rows_batch ON import_rows (org_id, batch_id, sheet, row_no);

    CREATE TABLE IF NOT EXISTS import_mappings (
      org_id     TEXT NOT NULL,
      profile    TEXT NOT NULL,
      mapping    TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (org_id, profile)
    );

    /* Per-hospital running counters for UHID / admission numbers. */
    CREATE TABLE IF NOT EXISTS org_counters (
      org_id TEXT NOT NULL, name TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (org_id, name)
    );
  `);

  addColumns(conn, "lab_tests", {
    /* What the hospital charges for this test. Zero until configured, which is
       honest: a charge of nothing is visibly unset, an invented price is not. */
    price: "REAL NOT NULL DEFAULT 0",
  });

  addColumns(conn, "clinical_audit", {
    /*
     * The record's version *after* this change.
     *
     * Without it the audit trail can say what changed but not between which two
     * versions, so a client holding version 7 cannot be told what happened
     * between 7 and 9 — which is exactly what it needs to decide whether its
     * edit actually conflicts or merely overlaps in time.
     */
    entity_version: "INTEGER",
  });

  addColumns(conn, "lab_analytes", {
    /* Reference ranges are not one-size-fits-all: a haemoglobin of 12.5 g/dL is
       normal in a woman and low in a man. An analyte may therefore have several
       rows, each valid for a sex and an age band. */
    applies_sex: "TEXT NOT NULL DEFAULT 'any'",
    age_min_years: "REAL",
    age_max_years: "REAL",
    /* Values outside these are not results, they are typing mistakes. */
    plausible_low: "REAL",
    plausible_high: "REAL",
    /* A change this large from the patient's own previous result is suspicious
       enough to make the technician confirm the sample belongs to them. */
    delta_abs: "REAL",
    delta_pct: "REAL",
    /* Computed by the platform from other analytes, never typed by hand. */
    derived_from: "TEXT NOT NULL DEFAULT ''",
    decimals: "INTEGER NOT NULL DEFAULT 2",
  });

  addColumns(conn, "lab_results", {
    /* Set when the platform calculated the value rather than a person entering it. */
    computed: "INTEGER NOT NULL DEFAULT 0",
    /* The delta-check outcome recorded at entry, so the reason a result was
       queried is visible later. */
    delta_note: "TEXT NOT NULL DEFAULT ''",
  });
}

/**
 * Adds columns to an existing table if they are missing.
 *
 * `CREATE TABLE IF NOT EXISTS` never alters a table that already exists, so a
 * hospital that has been running since before a column was added would silently
 * keep the old shape. This brings those databases forward without a migration
 * tool, and is a no-op on a fresh one.
 */
function addColumns(conn: DatabaseSync, table: string, columns: Record<string, string>) {
  let existing: Set<string>;
  try {
    existing = new Set(
      (conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
    );
  } catch {
    return; /* the table does not exist yet — its CREATE above already has these */
  }
  if (!existing.size) return;
  for (const [name, decl] of Object.entries(columns)) {
    if (existing.has(name)) continue;
    conn.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`);
  }
}
