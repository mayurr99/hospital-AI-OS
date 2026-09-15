/**
 * Bulk patient import.
 *
 * The previous implementation was a progress bar driven by `setInterval` that
 * never touched the server. This one does the real work:
 *
 *   upload → detect headers → map (remembered per hospital) → validate
 *          → detect duplicates → detect conflicts → PREVIEW
 *          → operator decides per row → commit in batches → results + error report
 *
 * Nothing is written to the patient tables until commit. Clinical history is
 * never overwritten by a spreadsheet: an import can create a patient, or update
 * a named set of demographic fields, and that is all.
 */

import ExcelJS from "exceljs";
import { all, get, id, nowIso, run } from "./db";
import { HttpError } from "./auth";
import { addEvent, clinicalAudit, tx, type AuditContext } from "./domain";
import {
  createPatient, findDuplicates, getPatient, updatePatient, addAllergy,
  type PatientMatch,
} from "./patients";
import { createAdmission, listBeds, listWards } from "./admissions";
import { addDiagnosis } from "./clinicaldata";
import { splitName } from "./backfill";
import { Check, parseDate, validatePatient, type ValidatedPatient } from "./validate";

/* --------------------------- canonical columns ------------------------- */

export interface ColumnDef {
  key: string;
  label: string;
  sheet: "PATIENTS" | "ADMISSIONS";
  required?: boolean;
  hint?: string;
  synonyms: string[];
}

/**
 * Legacy hospital spreadsheets never agree on headings. Matching is done on a
 * normalised form (lowercase, alphanumerics only), so "Phone No.", "phone_no"
 * and "PHONE NO" all collapse to the same key.
 */
export const COLUMNS: ColumnDef[] = [
  { key: "externalId", label: "External_Patient_ID", sheet: "PATIENTS", hint: "Your existing hospital/HIS id — used to link the ADMISSIONS sheet",
    synonyms: ["externalpatientid", "patientid", "hisid", "oldid", "legacyid", "sourceid", "refid", "registrationno", "regno", "ipdno", "opdno", "patientcode"] },
  { key: "uhid", label: "UHID", sheet: "PATIENTS", hint: "Leave blank to let the system generate one",
    synonyms: ["uhid", "mrn", "mrno", "hospitalno", "hospitalnumber", "uhidno", "unihid", "cardno", "healthid"] },
  { key: "fullName", label: "Patient_Name", sheet: "PATIENTS", hint: "Only if you do not have separate name columns",
    synonyms: ["patientname", "name", "fullname", "patient", "nameofpatient", "pname"] },
  { key: "firstName", label: "First_Name", sheet: "PATIENTS", required: true,
    synonyms: ["firstname", "fname", "givenname", "first"] },
  { key: "middleName", label: "Middle_Name", sheet: "PATIENTS",
    synonyms: ["middlename", "mname", "middle", "fathername", "fathersname"] },
  { key: "lastName", label: "Last_Name", sheet: "PATIENTS",
    synonyms: ["lastname", "lname", "surname", "familyname", "last"] },
  { key: "dateOfBirth", label: "DOB", sheet: "PATIENTS", hint: "YYYY-MM-DD or DD/MM/YYYY — preferred over age",
    synonyms: ["dob", "dateofbirth", "birthdate", "birthday", "dateofbirthdd", "bdate", "dobdate"] },
  { key: "age", label: "Age", sheet: "PATIENTS", hint: "Only used when DOB is missing; DOB is the source of truth",
    synonyms: ["age", "ageyears", "ageinyears", "agey", "patientage"] },
  { key: "gender", label: "Gender", sheet: "PATIENTS",
    synonyms: ["gender", "sex", "genders", "mf"] },
  { key: "mobile", label: "Mobile", sheet: "PATIENTS",
    synonyms: ["mobile", "mobileno", "mobilenumber", "phone", "phoneno", "phonenumber", "contact", "contactno", "contactnumber", "cell", "cellno", "primaryphone", "mob"] },
  { key: "altMobile", label: "Alternate_Mobile", sheet: "PATIENTS",
    synonyms: ["alternatemobile", "altmobile", "alternatephone", "altphone", "secondaryphone", "phone2", "mobile2", "otherphone", "landline"] },
  { key: "email", label: "Email", sheet: "PATIENTS",
    synonyms: ["email", "emailid", "emailaddress", "mail", "mailid"] },
  { key: "bloodGroup", label: "Blood_Group", sheet: "PATIENTS",
    synonyms: ["bloodgroup", "blood", "bg", "bloodtype", "bgroup"] },
  { key: "preferredLanguage", label: "Preferred_Language", sheet: "PATIENTS",
    synonyms: ["preferredlanguage", "language", "lang", "spokenlanguage", "prefdlang"] },
  { key: "addressLine", label: "Address", sheet: "PATIENTS",
    synonyms: ["address", "addressline", "addressline1", "residentialaddress", "fulladdress", "add"] },
  { key: "village", label: "Village", sheet: "PATIENTS", synonyms: ["village", "gaon", "locality", "area"] },
  { key: "taluka", label: "Taluka", sheet: "PATIENTS", synonyms: ["taluka", "tehsil", "taluk", "block", "mandal"] },
  { key: "district", label: "District", sheet: "PATIENTS", synonyms: ["district", "dist", "city", "town"] },
  { key: "state", label: "State", sheet: "PATIENTS", synonyms: ["state", "province", "region"] },
  { key: "pin", label: "PIN", sheet: "PATIENTS", synonyms: ["pin", "pincode", "postalcode", "zip", "zipcode", "postcode"] },
  { key: "emergencyName", label: "Emergency_Name", sheet: "PATIENTS",
    synonyms: ["emergencyname", "emergencycontact", "emergencycontactname", "kinname", "nextofkin", "guardianname", "relativename"] },
  { key: "emergencyRelation", label: "Emergency_Relation", sheet: "PATIENTS",
    synonyms: ["emergencyrelation", "relation", "relationship", "kinrelation", "relationwithpatient"] },
  { key: "emergencyMobile", label: "Emergency_Mobile", sheet: "PATIENTS",
    synonyms: ["emergencymobile", "emergencyphone", "emergencycontactno", "kinphone", "guardianphone", "relativephone"] },
  { key: "abhaId", label: "ABHA_ID", sheet: "PATIENTS",
    synonyms: ["abhaid", "abha", "abhanumber", "abhaaddress", "healthid", "ayushmanid"] },
  { key: "insuranceProvider", label: "Insurance_Provider", sheet: "PATIENTS",
    synonyms: ["insuranceprovider", "insurer", "insurance", "tpa", "payer", "insurancecompany", "scheme"] },
  { key: "insuranceNumber", label: "Insurance_Number", sheet: "PATIENTS",
    synonyms: ["insurancenumber", "policyno", "policynumber", "insuranceno", "tpaid", "memberid"] },
  { key: "allergies", label: "Allergies", sheet: "PATIENTS", hint: "Comma separated",
    synonyms: ["allergies", "allergy", "knownallergies", "drugallergy", "allergicto"] },
  { key: "existingConditions", label: "Existing_Conditions", sheet: "PATIENTS", hint: "Comma separated",
    synonyms: ["existingconditions", "conditions", "comorbidities", "knowncases", "pastmedicalhistory", "chronicconditions", "diagnosis"] },

  { key: "externalId", label: "External_Patient_ID", sheet: "ADMISSIONS", required: true, hint: "Must match a row in the PATIENTS sheet",
    synonyms: ["externalpatientid", "patientid", "hisid", "registrationno", "regno", "patientcode", "uhid", "mrn"] },
  { key: "admissionId", label: "Admission_ID", sheet: "ADMISSIONS",
    synonyms: ["admissionid", "ipdno", "ipno", "admissionno", "admno", "ipdnumber"] },
  { key: "admissionDate", label: "Admission_Date", sheet: "ADMISSIONS", required: true,
    synonyms: ["admissiondate", "admitdate", "dateofadmission", "doa", "admitteddate", "admissiondatetime"] },
  { key: "admissionType", label: "Admission_Type", sheet: "ADMISSIONS",
    synonyms: ["admissiontype", "type", "admtype", "categoryofadmission", "admissioncategory"] },
  { key: "department", label: "Department", sheet: "ADMISSIONS",
    synonyms: ["department", "dept", "speciality", "specialty", "unit"] },
  { key: "doctor", label: "Doctor", sheet: "ADMISSIONS",
    synonyms: ["doctor", "consultant", "treatingdoctor", "physician", "doctorname", "underdr", "admittingdoctor"] },
  { key: "ward", label: "Ward", sheet: "ADMISSIONS",
    synonyms: ["ward", "wardname", "floor", "wardno"] },
  { key: "room", label: "Room", sheet: "ADMISSIONS", synonyms: ["room", "roomno", "roomnumber"] },
  { key: "bed", label: "Bed", sheet: "ADMISSIONS", synonyms: ["bed", "bedno", "bednumber", "bedid"] },
  { key: "reason", label: "Reason", sheet: "ADMISSIONS",
    synonyms: ["reason", "complaint", "diagnosis", "admissionreason", "chiefcomplaint", "provisionaldiagnosis"] },
  { key: "status", label: "Status", sheet: "ADMISSIONS", synonyms: ["status", "admissionstatus", "currentstatus"] },
];

export function normalizeHeader(h: string): string {
  return String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const SYNONYM_INDEX = new Map<string, Map<string, string>>();
for (const sheet of ["PATIENTS", "ADMISSIONS"] as const) {
  const m = new Map<string, string>();
  for (const c of COLUMNS.filter((x) => x.sheet === sheet)) {
    m.set(normalizeHeader(c.label), c.key);
    for (const s of c.synonyms) m.set(s, c.key);
  }
  SYNONYM_INDEX.set(sheet, m);
}

/** Best-effort automatic mapping of a spreadsheet's headers to canonical keys. */
export function autoMap(headers: string[], sheet: "PATIENTS" | "ADMISSIONS", saved: Record<string, string> = {}) {
  const index = SYNONYM_INDEX.get(sheet)!;
  const mapping: Record<string, string> = {};
  const unmapped: string[] = [];
  for (const h of headers) {
    if (!h) continue;
    if (saved[h]) {
      mapping[h] = saved[h];
      continue;
    }
    const n = normalizeHeader(h);
    const hit = index.get(n);
    if (hit) mapping[h] = hit;
    else unmapped.push(h);
  }
  return { mapping, unmapped };
}

/* ---------------------------- saved mappings --------------------------- */

export function getSavedMapping(orgId: string, profile: string): Record<string, string> {
  const row = get<{ mapping: string }>("SELECT mapping FROM import_mappings WHERE org_id = ? AND profile = ?", [
    orgId, profile,
  ]);
  if (!row) return {};
  try {
    return JSON.parse(row.mapping) as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveMapping(ctx: AuditContext, profile: string, mapping: Record<string, string>) {
  run(
    `INSERT INTO import_mappings (org_id, profile, mapping, updated_at, updated_by) VALUES (?,?,?,?,?)
     ON CONFLICT(org_id, profile) DO UPDATE SET mapping = excluded.mapping, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [ctx.orgId, profile, JSON.stringify(mapping), nowIso(), ctx.session.user.id],
  );
}

/* ------------------------------- template ------------------------------ */

/** Builds the standard two-sheet workbook, with an instructions sheet. */
export async function buildTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Hospital AI OS";
  wb.created = new Date();

  const guide = wb.addWorksheet("INSTRUCTIONS");
  guide.columns = [{ width: 26 }, { width: 96 }];
  const lines: [string, string][] = [
    ["Sheet", "What it is for"],
    ["PATIENTS", "One row per person. This creates the permanent patient identity."],
    ["ADMISSIONS", "One row per inpatient stay. Linked to PATIENTS by External_Patient_ID."],
    ["", ""],
    ["Rule", "Detail"],
    ["Names", "Use First_Name / Middle_Name / Last_Name. If you only have one column, use Patient_Name and it will be split."],
    ["DOB vs Age", "DOB is the source of truth. Age is only used when DOB is blank, and the derived DOB is flagged as estimated."],
    ["Dates", "YYYY-MM-DD or DD/MM/YYYY. A real Excel date cell also works."],
    ["Mobile", "10 digits, or with +91. Numbers that cannot be a valid mobile are reported as row errors."],
    ["Blood group", "A+, A-, B+, B-, AB+, AB-, O+, O-. 'O positive' is understood."],
    ["UHID", "Leave blank to have one generated. If supplied it must be unique within your hospital."],
    ["Ward / Bed", "These belong on the ADMISSIONS sheet, never on PATIENTS. A patient is not permanently 'in' a ward."],
    ["Allergies", "Comma separated. Imported as structured allergy records."],
    ["Existing_Conditions", "Comma separated. Imported as diagnoses marked 'comorbidity'."],
    ["Your own headings", "You do not have to rename your columns. Upload your file and correct the mapping on screen — it is remembered for next time."],
  ];
  lines.forEach((l, i) => {
    const row = guide.addRow(l);
    if (i === 0 || i === 4) row.font = { bold: true };
  });

  for (const sheet of ["PATIENTS", "ADMISSIONS"] as const) {
    const ws = wb.addWorksheet(sheet);
    const cols = COLUMNS.filter((c) => c.sheet === sheet);
    ws.columns = cols.map((c) => ({ header: c.label, key: c.key, width: Math.max(14, c.label.length + 4) }));
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D9488" } };
    header.height = 22;
    ws.getRow(2).values = cols.map((c) => c.hint ?? "");
    ws.getRow(2).font = { italic: true, size: 9, color: { argb: "FF64748B" } };
    ws.views = [{ state: "frozen", ySplit: 2 }];
  }

  const p = wb.getWorksheet("PATIENTS")!;
  p.addRow({
    externalId: "HIS-1001", uhid: "", firstName: "Rekha", middleName: "Sunil", lastName: "Salunke",
    dateOfBirth: "1971-03-14", age: "", gender: "Female", mobile: "9822012345", altMobile: "",
    email: "rekha@example.com", bloodGroup: "B+", preferredLanguage: "mr",
    addressLine: "12 Shivaji Nagar", village: "Bhosari", taluka: "Haveli", district: "Pune",
    state: "Maharashtra", pin: "411026", emergencyName: "Sunil Salunke", emergencyRelation: "Husband",
    emergencyMobile: "9822012346", abhaId: "", insuranceProvider: "Star Health", insuranceNumber: "SH-88213",
    allergies: "Penicillin, Sulfa", existingConditions: "Type 2 Diabetes, Hypertension",
  });
  const a = wb.getWorksheet("ADMISSIONS")!;
  a.addRow({
    externalId: "HIS-1001", admissionId: "IP-2210", admissionDate: "2026-09-10",
    admissionType: "elective", department: "Orthopaedics", doctor: "Dr. A. Deshmukh",
    ward: "General Ward A", room: "", bed: "12", reason: "Post-operative recovery", status: "active",
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* -------------------------------- parsing ------------------------------ */

export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("");
    if (o.text !== undefined) return o.text;
    if (o.result !== undefined) return o.result;
    return "";
  }
  return v;
}

/** Reads an .xlsx or a CSV into named sheets. A CSV becomes the PATIENTS sheet. */
export async function parseWorkbook(buf: Buffer, filename: string): Promise<ParsedSheet[]> {
  const isCsv = /\.csv$/i.test(filename) || (!/\.xlsx?$/i.test(filename) && looksLikeCsv(buf));
  const wb = new ExcelJS.Workbook();

  if (isCsv) {
    const text = buf.toString("utf8");
    const rows = parseCsv(text);
    if (!rows.length) throw new HttpError(422, "The file appears to be empty");
    const headers = rows[0].map((h) => h.trim());
    const body = rows.slice(1).filter((r) => r.some((c) => String(c).trim() !== ""));
    return [{
      name: "PATIENTS",
      headers,
      rows: body.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]))),
    }];
  }

  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new HttpError(422, "That file could not be read as an Excel workbook. Save it as .xlsx or .csv and try again.");
  }

  const out: ParsedSheet[] = [];
  wb.eachSheet((ws) => {
    const name = ws.name.trim().toUpperCase();
    if (name === "INSTRUCTIONS") return;
    const headerRow = ws.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
      headers[col - 1] = String(cellValue(cell.value) ?? "").trim();
    });
    if (!headers.filter(Boolean).length) return;

    const rows: Record<string, unknown>[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const obj: Record<string, unknown> = {};
      let any = false;
      headers.forEach((h, i) => {
        if (!h) return;
        const v = cellValue(row.getCell(i + 1).value);
        obj[h] = v;
        if (String(v ?? "").trim() !== "") any = true;
      });
      // The template's second row is the italic hint line, not data.
      const joined = Object.values(obj).map((x) => String(x ?? "")).join(" ").toLowerCase();
      const isHint = rowNumber === 2 && /source of truth|leave blank|comma separated|must match/.test(joined);
      if (any && !isHint) rows.push({ ...obj, __row: rowNumber });
    });
    out.push({ name, headers: headers.filter(Boolean), rows });
  });

  if (!out.length) throw new HttpError(422, "No readable sheets were found in that workbook");
  return out;
}

function looksLikeCsv(buf: Buffer): boolean {
  const head = buf.subarray(0, 2048).toString("utf8");
  return head.includes(",") && !head.includes("PK");
}

/** Minimal RFC4180 CSV reader — quoted fields, embedded commas and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/* ------------------------------ validation ----------------------------- */

export interface RowIssue { field: string; message: string }
export interface RowConflict { field: string; existing: unknown; incoming: unknown }

export interface PreviewRow {
  rowNo: number;
  sheet: "PATIENTS" | "ADMISSIONS";
  raw: Record<string, unknown>;
  normalized: Record<string, unknown>;
  status: "VALID" | "INVALID" | "DUPLICATE";
  action: "create" | "update" | "skip" | "use_existing";
  errors: RowIssue[];
  warnings: RowIssue[];
  conflicts: RowConflict[];
  matches: PatientMatch[];
  matchPatientId: string | null;
  matchStrength: string;
}

/** Demographic fields an import is allowed to change on an existing patient. */
export const UPDATABLE_FIELDS = [
  "externalId", "firstName", "middleName", "lastName", "dateOfBirth", "gender",
  "mobile", "altMobile", "email", "bloodGroup", "preferredLanguage",
  "addressLine", "village", "taluka", "district", "state", "pin",
  "emergencyName", "emergencyRelation", "emergencyMobile",
  "insuranceProvider", "insuranceNumber",
] as const;

function applyMapping(raw: Record<string, unknown>, mapping: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [header, key] of Object.entries(mapping)) {
    if (!key || key === "__ignore") continue;
    const v = raw[header];
    if (v === undefined) continue;
    if (out[key] === undefined || String(out[key] ?? "") === "") out[key] = v;
  }
  return out;
}

export interface BuildPreviewInput {
  orgId: string;
  sheets: ParsedSheet[];
  mapping: { PATIENTS: Record<string, string>; ADMISSIONS: Record<string, string> };
}

export function buildPreview(input: BuildPreviewInput) {
  const patientsSheet = input.sheets.find((s) => s.name === "PATIENTS") ?? input.sheets[0];
  const admissionsSheet = input.sheets.find((s) => s.name === "ADMISSIONS");

  const patientRows: PreviewRow[] = [];
  const seenExternal = new Map<string, number>();
  const seenUhid = new Map<string, number>();

  for (const raw of patientsSheet?.rows ?? []) {
    const rowNo = Number(raw.__row ?? patientRows.length + 2);
    const mapped = applyMapping(raw, input.mapping.PATIENTS);

    // A single "Patient_Name" column is split only when no first name was mapped.
    if (!String(mapped.firstName ?? "").trim() && String(mapped.fullName ?? "").trim()) {
      const parts = splitName(String(mapped.fullName));
      mapped.firstName = parts.firstName;
      if (!mapped.middleName) mapped.middleName = parts.middleName;
      if (!mapped.lastName) mapped.lastName = parts.lastName;
    }

    const check = new Check();
    const { value } = validatePatient(mapped, check);
    const errors: RowIssue[] = check.issues.map((i) => ({ field: i.field, message: i.message }));
    const warnings: RowIssue[] = [];

    if (!value.mobile) warnings.push({ field: "mobile", message: "No mobile number — this patient cannot be called or reminded" });
    if (!value.dateOfBirth) warnings.push({ field: "dateOfBirth", message: "No date of birth and no age" });
    else if (value.dobEstimated) warnings.push({ field: "dateOfBirth", message: "Date of birth estimated from age — recorded as estimated" });

    // Duplicates inside the file itself, before we look at the database.
    const ext = String(value.externalId ?? "");
    if (ext) {
      const prev = seenExternal.get(ext);
      if (prev) errors.push({ field: "externalId", message: `Duplicated in this file — also on row ${prev}` });
      else seenExternal.set(ext, rowNo);
    }
    if (value.uhid) {
      const prev = seenUhid.get(value.uhid);
      if (prev) errors.push({ field: "uhid", message: `Duplicated in this file — also on row ${prev}` });
      else seenUhid.set(value.uhid, rowNo);
    }

    const matches = errors.length ? [] : findDuplicates(input.orgId, value);
    const best = matches[0] ?? null;

    const conflicts: RowConflict[] = [];
    if (best) {
      const existing = getPatient(input.orgId, best.patientId) as unknown as Record<string, unknown>;
      for (const f of UPDATABLE_FIELDS) {
        const incoming = (value as unknown as Record<string, unknown>)[f];
        const current = existing[f];
        if (incoming === null || incoming === undefined || incoming === "") continue;
        if (current === null || current === undefined || current === "") continue;
        if (String(current) !== String(incoming)) conflicts.push({ field: f, existing: current, incoming });
      }
    }

    // `allergies` and `existingConditions` are not patient columns — they become
    // structured allergy and diagnosis records at commit — so they ride along on
    // the normalised payload rather than through the demographic validator.
    const normalized: Record<string, unknown> = {
      ...(value as unknown as Record<string, unknown>),
      allergies: String(mapped.allergies ?? "").trim(),
      existingConditions: String(mapped.existingConditions ?? "").trim(),
    };

    patientRows.push({
      rowNo,
      sheet: "PATIENTS",
      raw: stripInternal(raw),
      normalized,
      status: errors.length ? "INVALID" : best ? "DUPLICATE" : "VALID",
      // A strong match defaults to "use existing" rather than silently updating.
      action: errors.length ? "skip" : best ? (best.strength === "strong" ? "use_existing" : "use_existing") : "create",
      errors, warnings, conflicts, matches,
      matchPatientId: best?.patientId ?? null,
      matchStrength: best?.strength ?? "",
    });
  }

  /* ----------------------------- admissions ---------------------------- */
  const admissionRows: PreviewRow[] = [];
  if (admissionsSheet) {
    const wards = listWards(input.orgId);
    const beds = listBeds(input.orgId);

    for (const raw of admissionsSheet.rows) {
      const rowNo = Number(raw.__row ?? admissionRows.length + 2);
      const mapped = applyMapping(raw, input.mapping.ADMISSIONS);
      const errors: RowIssue[] = [];
      const warnings: RowIssue[] = [];

      const ext = String(mapped.externalId ?? "").trim();
      if (!ext) errors.push({ field: "externalId", message: "External_Patient_ID is required to link this admission" });
      else if (!seenExternal.has(ext)) {
        const known = findDuplicates(input.orgId, { externalId: ext, uhid: ext });
        if (!known.length) errors.push({ field: "externalId", message: `No patient with id "${ext}" in this file or in this hospital` });
      }

      const admissionDate = parseDate(mapped.admissionDate);
      if (!admissionDate) errors.push({ field: "admissionDate", message: "Admission date is missing or unreadable" });
      else if (admissionDate > new Date().toISOString().slice(0, 10)) {
        errors.push({ field: "admissionDate", message: "Admission date is in the future" });
      }

      const wardName = String(mapped.ward ?? "").trim();
      const bedNo = String(mapped.bed ?? "").trim();
      let bedId: string | null = null;
      if (wardName || bedNo) {
        const ward = wards.find((w) => w.name.toLowerCase() === wardName.toLowerCase());
        if (wardName && !ward) warnings.push({ field: "ward", message: `Ward "${wardName}" not found — admission will be created without a bed` });
        const bed = beds.find(
          (b) => (!ward || b.wardId === ward.id) && b.number.toLowerCase() === bedNo.toLowerCase(),
        );
        if (bedNo && !bed) warnings.push({ field: "bed", message: `Bed "${bedNo}" not found — admission will be created without a bed` });
        else if (bed && bed.status !== "AVAILABLE") {
          warnings.push({ field: "bed", message: `Bed ${bed.number} is ${bed.status.toLowerCase()} — admission will be created without a bed` });
        } else if (bed) bedId = bed.id;
      }

      admissionRows.push({
        rowNo, sheet: "ADMISSIONS",
        raw: stripInternal(raw),
        normalized: {
          externalId: ext,
          admissionId: String(mapped.admissionId ?? ""),
          admissionDate,
          admissionType: normalizeAdmissionType(mapped.admissionType),
          department: String(mapped.department ?? ""),
          doctor: String(mapped.doctor ?? ""),
          ward: wardName, room: String(mapped.room ?? ""), bed: bedNo, bedId,
          reason: String(mapped.reason ?? ""),
          status: String(mapped.status ?? "active").toLowerCase(),
        },
        status: errors.length ? "INVALID" : "VALID",
        action: errors.length ? "skip" : "create",
        errors, warnings, conflicts: [], matches: [], matchPatientId: null, matchStrength: "",
      });
    }
  }

  const summary = {
    totalRows: patientRows.length + admissionRows.length,
    patientRows: patientRows.length,
    validRows: patientRows.filter((r) => r.status === "VALID").length,
    invalidRows: patientRows.filter((r) => r.status === "INVALID").length,
    duplicateRows: patientRows.filter((r) => r.status === "DUPLICATE").length,
    warningRows: patientRows.filter((r) => r.warnings.length).length,
    toCreate: patientRows.filter((r) => r.action === "create").length,
    toUpdate: patientRows.filter((r) => r.action === "update").length,
    toSkip: patientRows.filter((r) => r.action === "skip" || r.action === "use_existing").length,
    admissionsTotal: admissionRows.length,
    admissionsValid: admissionRows.filter((r) => r.status === "VALID").length,
    admissionsInvalid: admissionRows.filter((r) => r.status === "INVALID").length,
  };

  return { patientRows, admissionRows, summary };
}

function stripInternal(raw: Record<string, unknown>) {
  const { __row, ...rest } = raw as Record<string, unknown> & { __row?: number };
  void __row;
  return rest;
}

function normalizeAdmissionType(v: unknown): string {
  const s = String(v ?? "").toLowerCase().trim();
  if (/emerg|casualty|ed\b/.test(s)) return "emergency";
  if (/matern|obst|deliver|lscs/.test(s)) return "maternity";
  if (/day ?care|daycare|day-care/.test(s)) return "daycare";
  if (/transfer/.test(s)) return "transfer_in";
  return "elective";
}

/* ------------------------------ persistence ---------------------------- */

export function saveBatch(ctx: AuditContext, input: {
  filename: string; bytes: number;
  mapping: unknown; detectedHeaders: unknown; options: unknown;
  patientRows: PreviewRow[]; admissionRows: PreviewRow[];
  summary: ReturnType<typeof buildPreview>["summary"];
}): string {
  const batchId = id("imp");
  tx(() => {
    run(
      `INSERT INTO import_batches
         (id, org_id, uploaded_by, uploaded_by_name, uploaded_at, filename, bytes, status, mapping, detected_headers, options,
          total_rows, valid_rows, invalid_rows, duplicate_rows, warning_rows, admissions_total)
       VALUES (?,?,?,?,?,?,?, 'PREVIEW', ?,?,?,?,?,?,?,?,?)`,
      [
        batchId, ctx.orgId, ctx.session.user.id, ctx.session.user.name, nowIso(),
        input.filename, input.bytes, JSON.stringify(input.mapping), JSON.stringify(input.detectedHeaders),
        JSON.stringify(input.options), input.summary.totalRows, input.summary.validRows,
        input.summary.invalidRows, input.summary.duplicateRows, input.summary.warningRows,
        input.summary.admissionsTotal,
      ],
    );
    for (const r of [...input.patientRows, ...input.admissionRows]) {
      run(
        `INSERT INTO import_rows
           (id, org_id, batch_id, sheet, row_no, raw, normalized, status, action, match_patient_id, match_reason, match_strength, errors, warnings, conflicts)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id("irow"), ctx.orgId, batchId, r.sheet, r.rowNo,
          JSON.stringify(r.raw), JSON.stringify(r.normalized), r.status, r.action,
          r.matchPatientId, r.matches[0]?.reason ?? "", r.matchStrength,
          JSON.stringify(r.errors), JSON.stringify(r.warnings), JSON.stringify(r.conflicts),
        ],
      );
    }
  });
  clinicalAudit(ctx, {
    entityType: "import_batch", entityId: batchId, action: "import.previewed",
    after: { filename: input.filename, ...input.summary },
  });
  return batchId;
}

export function getBatch(orgId: string, batchId: string) {
  const b = get<Record<string, unknown>>("SELECT * FROM import_batches WHERE org_id = ? AND id = ?", [orgId, batchId]);
  if (!b) throw new HttpError(404, "Import batch not found in this hospital");
  const rows = all<Record<string, unknown>>(
    "SELECT * FROM import_rows WHERE org_id = ? AND batch_id = ? ORDER BY sheet DESC, row_no", [orgId, batchId],
  );
  return {
    batch: {
      id: b.id as string, filename: b.filename as string, status: b.status as string,
      uploadedBy: b.uploaded_by_name as string, uploadedAt: b.uploaded_at as string,
      bytes: b.bytes as number,
      mapping: JSON.parse(String(b.mapping || "{}")),
      detectedHeaders: JSON.parse(String(b.detected_headers || "{}")),
      totalRows: b.total_rows as number, validRows: b.valid_rows as number,
      invalidRows: b.invalid_rows as number, duplicateRows: b.duplicate_rows as number,
      warningRows: b.warning_rows as number,
      createdCount: b.created_count as number, updatedCount: b.updated_count as number,
      skippedCount: b.skipped_count as number, failedCount: b.failed_count as number,
      admissionsTotal: b.admissions_total as number,
      admissionsCreated: b.admissions_created as number, admissionsFailed: b.admissions_failed as number,
      committedAt: (b.committed_at as string) ?? null, error: (b.error as string) ?? null,
    },
    rows: rows.map((r) => ({
      id: r.id as string, sheet: r.sheet as string, rowNo: r.row_no as number,
      raw: JSON.parse(String(r.raw || "{}")),
      normalized: JSON.parse(String(r.normalized || "{}")),
      status: r.status as string, action: r.action as string,
      matchPatientId: (r.match_patient_id as string) ?? null,
      matchReason: r.match_reason as string, matchStrength: r.match_strength as string,
      errors: JSON.parse(String(r.errors || "[]")) as RowIssue[],
      warnings: JSON.parse(String(r.warnings || "[]")) as RowIssue[],
      conflicts: JSON.parse(String(r.conflicts || "[]")) as RowConflict[],
      resultId: (r.result_id as string) ?? null,
      resultMessage: r.result_message as string,
    })),
  };
}

export function listBatches(orgId: string, limit = 25) {
  return all<Record<string, unknown>>(
    "SELECT * FROM import_batches WHERE org_id = ? ORDER BY uploaded_at DESC LIMIT ?", [orgId, limit],
  ).map((b) => ({
    id: b.id as string, filename: b.filename as string, status: b.status as string,
    uploadedBy: b.uploaded_by_name as string, uploadedAt: b.uploaded_at as string,
    totalRows: b.total_rows as number, createdCount: b.created_count as number,
    updatedCount: b.updated_count as number, skippedCount: b.skipped_count as number,
    failedCount: b.failed_count as number, admissionsCreated: b.admissions_created as number,
    committedAt: (b.committed_at as string) ?? null,
  }));
}

/* -------------------------------- commit ------------------------------- */

export type ConflictPolicy = "keep_existing" | "use_excel" | "review";

export interface CommitOptions {
  /** rowId → action chosen by the operator in the preview */
  actions?: Record<string, "create" | "update" | "skip" | "use_existing">;
  conflictPolicy?: ConflictPolicy;
  importAdmissions?: boolean;
}

/**
 * Commits a previewed batch.
 *
 * Each row is its own transaction, so a single bad row fails that row and is
 * reported, rather than silently corrupting a partially-applied batch. The
 * batch-level status records whether everything, some, or none of it applied.
 */
export function commitBatch(ctx: AuditContext, batchId: string, opts: CommitOptions = {}) {
  const { batch, rows } = getBatch(ctx.orgId, batchId);
  if (batch.status === "COMMITTED") throw new HttpError(409, "This import has already been committed");

  const policy: ConflictPolicy = opts.conflictPolicy ?? "keep_existing";
  const actions = opts.actions ?? {};

  let created = 0, updated = 0, skipped = 0, failed = 0;
  let admissionsCreated = 0, admissionsFailed = 0;
  const externalToPatient = new Map<string, string>();

  for (const r of rows.filter((x) => x.sheet === "PATIENTS")) {
    const action = actions[r.id] ?? r.action;
    const v = r.normalized as unknown as ValidatedPatient & { allergies?: string; existingConditions?: string };

    if (r.errors.length || action === "skip") {
      skipped += 1;
      markRow(ctx.orgId, r.id, r.errors.length ? "FAILED" : "SKIPPED", null, r.errors.length ? "Row had validation errors" : "Skipped by operator");
      if (r.errors.length) failed += 1;
      continue;
    }

    try {
      tx(() => {
        if (action === "create") {
          /* The importer matches across the whole sheet before it writes
             anything, so the per-row guard would refuse rows it has already
             decided about. */
          const p = createPatient(ctx, v, { source: "import", importBatchId: batchId, skipDuplicateCheck: true });
          created += 1;
          if (v.externalId) externalToPatient.set(String(v.externalId), p.id);
          attachClinical(ctx, p.id, v);
          markRow(ctx.orgId, r.id, "CREATED", p.id, `Created ${p.uhid}`);
        } else if (action === "update" && r.matchPatientId) {
          const patch: Record<string, unknown> = {};
          const conflictFields = new Set(r.conflicts.map((c) => c.field));
          for (const f of UPDATABLE_FIELDS) {
            const incoming = (v as unknown as Record<string, unknown>)[f];
            if (incoming === null || incoming === undefined || incoming === "") continue;
            // A conflicting value is only overwritten when the operator asked for it.
            if (conflictFields.has(f) && policy !== "use_excel") continue;
            patch[f] = incoming;
          }
          updatePatient(ctx, r.matchPatientId, patch, `Excel import ${batch.filename}`);
          updated += 1;
          if (v.externalId) externalToPatient.set(String(v.externalId), r.matchPatientId);
          markRow(ctx.orgId, r.id, "UPDATED", r.matchPatientId, `Updated ${Object.keys(patch).length} field(s)`);
        } else {
          // use_existing — link the spreadsheet row to the existing patient and
          // change nothing. Clinical history is never touched by an import.
          skipped += 1;
          if (v.externalId && r.matchPatientId) externalToPatient.set(String(v.externalId), r.matchPatientId);
          markRow(ctx.orgId, r.id, "SKIPPED", r.matchPatientId, "Existing patient kept unchanged");
        }
      });
    } catch (e) {
      failed += 1;
      markRow(ctx.orgId, r.id, "FAILED", null, e instanceof Error ? e.message : String(e));
    }
  }

  if (opts.importAdmissions !== false) {
    for (const r of rows.filter((x) => x.sheet === "ADMISSIONS")) {
      if (r.errors.length) {
        admissionsFailed += 1;
        markRow(ctx.orgId, r.id, "FAILED", null, "Row had validation errors");
        continue;
      }
      const n = r.normalized as Record<string, unknown>;
      const ext = String(n.externalId ?? "");
      let patientId = externalToPatient.get(ext) ?? null;
      if (!patientId) {
        const found = findDuplicates(ctx.orgId, { externalId: ext, uhid: ext });
        patientId = found[0]?.patientId ?? null;
      }
      if (!patientId) {
        admissionsFailed += 1;
        markRow(ctx.orgId, r.id, "FAILED", null, `No patient for external id ${ext}`);
        continue;
      }
      try {
        const adm = createAdmission(ctx, {
          patientId,
          type: String(n.admissionType ?? "elective"),
          admittedAt: String(n.admissionDate ?? ""),
          reason: String(n.reason ?? ""),
          bedId: (n.bedId as string) ?? null,
          externalAdmissionId: String(n.admissionId ?? "") || null,
          importBatchId: batchId,
        });
        admissionsCreated += 1;
        markRow(ctx.orgId, r.id, "CREATED", adm.id, `Created ${adm.admissionNo}`);
      } catch (e) {
        admissionsFailed += 1;
        markRow(ctx.orgId, r.id, "FAILED", null, e instanceof Error ? e.message : String(e));
      }
    }
  }

  const status = failed + admissionsFailed === 0 ? "COMMITTED" : created + updated > 0 ? "PARTIAL" : "FAILED";
  run(
    `UPDATE import_batches SET status = ?, created_count = ?, updated_count = ?, skipped_count = ?, failed_count = ?,
       admissions_created = ?, admissions_failed = ?, committed_at = ? WHERE org_id = ? AND id = ?`,
    [status, created, updated, skipped, failed, admissionsCreated, admissionsFailed, nowIso(), ctx.orgId, batchId],
  );

  clinicalAudit(ctx, {
    entityType: "import_batch", entityId: batchId, action: "import.committed",
    after: { status, created, updated, skipped, failed, admissionsCreated, admissionsFailed },
  });

  return { status, created, updated, skipped, failed, admissionsCreated, admissionsFailed };
}

function markRow(orgId: string, rowId: string, status: string, resultId: string | null, message: string) {
  run("UPDATE import_rows SET status = ?, result_id = ?, result_message = ? WHERE org_id = ? AND id = ?", [
    status, resultId, message.slice(0, 500), orgId, rowId,
  ]);
}

/** Allergies and comorbidities arrive as comma-separated text; store them structured. */
function attachClinical(ctx: AuditContext, patientId: string, v: Record<string, unknown>) {
  const allergies = String(v.allergies ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const a of allergies) {
    try {
      addAllergy(ctx, patientId, { substance: a, category: "unknown", note: "Imported from spreadsheet" });
    } catch { /* one bad allergy string must not fail the patient */ }
  }
  const conditions = String(v.existingConditions ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const c of conditions) {
    try {
      addDiagnosis(ctx, { patientId, description: c, category: "comorbidity", codeSystem: "free-text" });
    } catch { /* likewise */ }
  }
  if (allergies.length || conditions.length) {
    addEvent(ctx.orgId, {
      patientId, kind: "import", title: "Clinical history imported",
      detail: `${allergies.length} allergy record(s), ${conditions.length} condition(s)`,
      actor: ctx.session.user.name,
    });
  }
}

/* ---------------------------- error report ----------------------------- */

export function errorReportCsv(orgId: string, batchId: string): string {
  const { rows } = getBatch(orgId, batchId);
  const bad = rows.filter((r) => r.errors.length || r.warnings.length || r.status === "FAILED");
  const header = ["Sheet", "Row", "Status", "Field", "Problem", "Value", "Outcome"];
  const lines = [header.join(",")];
  for (const r of bad) {
    const issues = [
      ...r.errors.map((e) => ["error", e] as const),
      ...r.warnings.map((w) => ["warning", w] as const),
    ];
    if (!issues.length && r.status === "FAILED") {
      lines.push(csvRow([r.sheet, r.rowNo, r.status, "", r.resultMessage, "", r.resultMessage]));
      continue;
    }
    for (const [kind, issue] of issues) {
      const value = (r.raw as Record<string, unknown>)[issue.field] ?? (r.normalized as Record<string, unknown>)[issue.field] ?? "";
      lines.push(csvRow([r.sheet, r.rowNo, kind, issue.field, issue.message, value, r.resultMessage]));
    }
  }
  return lines.join("\n");
}

function csvRow(cells: unknown[]): string {
  return cells
    .map((c) => {
      const s = String(c ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(",");
}
