/**
 * Server-side validation.
 *
 * Front-end validation is a convenience; this is the rule. Every clinical write
 * route runs its payload through here before it reaches the database, and the
 * bulk importer reuses exactly the same functions so an imported row is held to
 * the same standard as a typed one.
 */

import { HttpError } from "./auth";

export const GENDERS = ["male", "female", "other", "unknown"] as const;
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const PATIENT_STATUSES = ["active", "inactive", "deceased", "merged"] as const;
export const ADMISSION_TYPES = ["emergency", "elective", "maternity", "daycare", "transfer_in"] as const;
export const BED_STATUSES = ["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING", "MAINTENANCE", "BLOCKED"] as const;
export const LAB_STATUSES = [
  "ORDERED", "SAMPLE_COLLECTED", "PROCESSING", "RESULT_ENTERED", "VERIFIED", "RELEASED", "CANCELLED",
] as const;
export const SEVERITIES = ["mild", "moderate", "severe", "life_threatening"] as const;
export const ROUTES = ["oral", "iv", "im", "sc", "topical", "inhaled", "rectal", "ophthalmic", "nasal", "other"] as const;

/** A field-addressed problem, so the UI can point at the offending input. */
export interface FieldIssue {
  field: string;
  message: string;
}

export class ValidationError extends HttpError {
  issues: FieldIssue[];
  constructor(issues: FieldIssue[]) {
    super(422, issues.map((i) => `${i.field}: ${i.message}`).join("; ") || "Validation failed");
    this.issues = issues;
  }
}

/** Collects issues so a form comes back with every problem, not just the first. */
export class Check {
  issues: FieldIssue[] = [];

  add(field: string, message: string) {
    this.issues.push({ field, message });
    return this;
  }

  /** Adds an issue when `ok` is false. Returns `ok` so callers can branch. */
  assert(ok: boolean, field: string, message: string): boolean {
    if (!ok) this.add(field, message);
    return ok;
  }

  throwIfAny() {
    if (this.issues.length) throw new ValidationError(this.issues);
  }
}

/* ----------------------------- primitives ----------------------------- */

export function str(v: unknown, max = 500): string {
  if (v === null || v === undefined) return "";
  return String(v).trim().slice(0, max);
}

export function optionalStr(v: unknown, max = 500): string | null {
  const s = str(v, max);
  return s === "" ? null : s;
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

export function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = str(v).toLowerCase();
  return ["1", "true", "yes", "y"].includes(s);
}

/* -------------------------------- dates -------------------------------- */

/** Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, an Excel serial, or a Date. */
export function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);

  if (typeof v === "number" && v > 20000 && v < 60000) {
    // Excel serial date (1900 epoch, with the well-known 1900 leap-year offset).
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  const s = String(v).trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function iso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function parseDateTime(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  const s = String(v).trim();
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  const day = parseDate(s);
  return day ? new Date(`${day}T00:00:00.000Z`).toISOString() : null;
}

/** Age from date of birth. DOB is the source of truth whenever it exists. */
export function ageFromDob(dob: string | null | undefined, at = new Date()): number | null {
  if (!dob) return null;
  const d = new Date(`${dob}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  let age = at.getUTCFullYear() - d.getUTCFullYear();
  const before =
    at.getUTCMonth() < d.getUTCMonth() ||
    (at.getUTCMonth() === d.getUTCMonth() && at.getUTCDate() < d.getUTCDate());
  if (before) age -= 1;
  return age >= 0 && age < 140 ? age : null;
}

/** Only used when a legacy row has an age but no DOB. Flagged as estimated. */
export function dobFromAge(age: number, at = new Date()): string {
  return new Date(Date.UTC(at.getUTCFullYear() - age, 0, 1)).toISOString().slice(0, 10);
}

/* ------------------------------- contacts ------------------------------ */

/** Normalises an Indian mobile to +91XXXXXXXXXX where it can; otherwise E.164-ish. */
export function normalizeMobile(v: unknown): string {
  let s = str(v, 40).replace(/[\s\-().]/g, "");
  if (!s) return "";
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (/^\+/.test(s)) return s;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

export function isValidMobile(v: string): boolean {
  if (!v) return false;
  const digits = v.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return false;
  // An Indian mobile never starts 0-5 after the country code.
  if (v.startsWith("+91")) return /^[6-9]\d{9}$/.test(digits.slice(2));
  return true;
}

export function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

export function normalizeBloodGroup(v: unknown): string | null {
  const raw = str(v, 10).toUpperCase().replace(/\s|BLOOD|GROUP/g, "");
  if (!raw) return null;
  const map: Record<string, string> = {
    "A+": "A+", APOS: "A+", APOSITIVE: "A+", "A-": "A-", ANEG: "A-", ANEGATIVE: "A-",
    "B+": "B+", BPOS: "B+", BPOSITIVE: "B+", "B-": "B-", BNEG: "B-", BNEGATIVE: "B-",
    "AB+": "AB+", ABPOS: "AB+", ABPOSITIVE: "AB+", "AB-": "AB-", ABNEG: "AB-", ABNEGATIVE: "AB-",
    "O+": "O+", OPOS: "O+", OPOSITIVE: "O+", "O-": "O-", ONEG: "O-", ONEGATIVE: "O-",
  };
  const key = raw.replace(/POSITIVE$/, "POS").replace(/NEGATIVE$/, "NEG");
  return map[raw] ?? map[key] ?? null;
}

export function normalizeGender(v: unknown): string {
  const s = str(v, 20).toLowerCase();
  if (["m", "male", "man", "boy", "पुरुष"].includes(s)) return "male";
  if (["f", "female", "woman", "girl", "स्त्री", "महिला"].includes(s)) return "female";
  if (["o", "other", "trans", "transgender", "non-binary"].includes(s)) return "other";
  return "unknown";
}

export function normalizePin(v: unknown): string {
  return str(v, 10).replace(/\D/g, "").slice(0, 6);
}

export function isValidPin(v: string): boolean {
  return v === "" || /^[1-9]\d{5}$/.test(v);
}

/** ABHA is 14 digits, usually written 12-3456-7890-1234. */
export function normalizeAbha(v: unknown): string | null {
  const digits = str(v, 30).replace(/\D/g, "");
  if (!digits) return null;
  return digits.length === 14 ? digits : digits;
}

export function isValidAbha(v: string | null): boolean {
  return v === null || v === "" || /^\d{14}$/.test(v);
}

/* --------------------------- composite checks -------------------------- */

export interface PatientInput {
  uhid?: string;
  externalId?: string | null;
  firstName: string;
  middleName?: string;
  lastName?: string;
  dateOfBirth?: string | null;
  ageYears?: number | null;
  gender?: string;
  mobile?: string;
  altMobile?: string;
  email?: string;
  bloodGroup?: string | null;
  preferredLanguage?: string;
  addressLine?: string;
  village?: string; taluka?: string; district?: string; state?: string; pin?: string;
  emergencyName?: string; emergencyRelation?: string; emergencyMobile?: string;
  abhaId?: string | null;
  insuranceProvider?: string; insuranceNumber?: string;
  status?: string;
  facilityId?: string | null; departmentId?: string | null; providerId?: string | null;
}

/** Normalises and validates a patient payload. Returns the cleaned record. */
export function validatePatient(input: Record<string, unknown>, check = new Check(), prefix = "") {
  const f = (n: string) => (prefix ? `${prefix}.${n}` : n);

  const firstName = str(input.firstName ?? input.first_name, 80);
  const lastName = str(input.lastName ?? input.last_name, 80);
  const middleName = str(input.middleName ?? input.middle_name, 80);

  if (!firstName) check.add(f("firstName"), "First name is required");

  let dateOfBirth = parseDate(input.dateOfBirth ?? input.date_of_birth ?? input.dob);
  const rawAge = int(input.ageYears ?? input.age);
  let dobEstimated = false;

  if (dateOfBirth) {
    const today = new Date().toISOString().slice(0, 10);
    if (dateOfBirth > today) {
      check.add(f("dateOfBirth"), "Date of birth is in the future");
      dateOfBirth = null;
    } else if (dateOfBirth < "1900-01-01") {
      check.add(f("dateOfBirth"), "Date of birth is before 1900");
      dateOfBirth = null;
    }
  } else if ((input.dateOfBirth ?? input.dob) && !dateOfBirth) {
    check.add(f("dateOfBirth"), "Date of birth could not be read — use YYYY-MM-DD or DD/MM/YYYY");
  }

  if (!dateOfBirth && rawAge !== null) {
    if (rawAge < 0 || rawAge > 130) {
      check.add(f("age"), "Age must be between 0 and 130");
    } else {
      dateOfBirth = dobFromAge(rawAge);
      dobEstimated = true;
    }
  }

  const gender = normalizeGender(input.gender);
  const mobile = normalizeMobile(input.mobile ?? input.phone);
  if (mobile && !isValidMobile(mobile)) check.add(f("mobile"), `Invalid mobile number "${str(input.mobile ?? input.phone, 30)}"`);

  const altMobile = normalizeMobile(input.altMobile ?? input.alt_mobile);
  if (altMobile && !isValidMobile(altMobile)) check.add(f("altMobile"), "Invalid alternate mobile number");

  const email = str(input.email, 160).toLowerCase();
  if (email && !isValidEmail(email)) check.add(f("email"), `Invalid email address "${email}"`);

  const rawBlood = str(input.bloodGroup ?? input.blood_group, 10);
  const bloodGroup = normalizeBloodGroup(rawBlood);
  if (rawBlood && !bloodGroup) check.add(f("bloodGroup"), `Unknown blood group "${rawBlood}"`);

  const pin = normalizePin(input.pin);
  if (!isValidPin(pin)) check.add(f("pin"), `Invalid PIN code "${str(input.pin, 10)}"`);

  const abhaId = normalizeAbha(input.abhaId ?? input.abha_id);
  if (abhaId && !isValidAbha(abhaId)) check.add(f("abhaId"), "ABHA identifier must be 14 digits");

  const emergencyMobile = normalizeMobile(input.emergencyMobile ?? input.emergency_mobile);
  if (emergencyMobile && !isValidMobile(emergencyMobile)) check.add(f("emergencyMobile"), "Invalid emergency contact number");

  const status = str(input.status, 20).toLowerCase() || "active";
  if (!(PATIENT_STATUSES as readonly string[]).includes(status)) check.add(f("status"), `Unknown patient status "${status}"`);

  return {
    check,
    value: {
      uhid: str(input.uhid, 40).toUpperCase(),
      externalId: optionalStr(input.externalId ?? input.external_id, 60),
      firstName, middleName, lastName,
      dateOfBirth, dobEstimated,
      ageYears: dateOfBirth ? ageFromDob(dateOfBirth) : rawAge,
      gender, mobile, altMobile, email, bloodGroup,
      preferredLanguage: str(input.preferredLanguage ?? input.preferred_language, 10).toLowerCase() || "en",
      addressLine: str(input.addressLine ?? input.address, 300),
      village: str(input.village, 80),
      taluka: str(input.taluka, 80),
      district: str(input.district, 80),
      state: str(input.state, 80),
      pin,
      emergencyName: str(input.emergencyName ?? input.emergency_name, 120),
      emergencyRelation: str(input.emergencyRelation ?? input.emergency_relation, 60),
      emergencyMobile,
      abhaId,
      insuranceProvider: str(input.insuranceProvider ?? input.insurance_provider, 120),
      insuranceNumber: str(input.insuranceNumber ?? input.insurance_number, 80),
      status,
      facilityId: optionalStr(input.facilityId ?? input.facility_id, 60),
      departmentId: optionalStr(input.departmentId ?? input.department_id, 60),
      providerId: optionalStr(input.providerId ?? input.provider_id, 60),
      carePathway: str(input.carePathway ?? input.care_pathway, 120),
    },
  };
}

export type ValidatedPatient = ReturnType<typeof validatePatient>["value"];

export function requireEnum<T extends string>(
  value: unknown, allowed: readonly T[], field: string, fallback?: T,
): T {
  const s = str(value, 40);
  if (!s && fallback !== undefined) return fallback;
  if (!(allowed as readonly string[]).includes(s)) {
    throw new ValidationError([{ field, message: `Must be one of: ${allowed.join(", ")}` }]);
  }
  return s as T;
}

/** Guards a state machine so a workflow cannot skip a step. */
export function requireTransition(
  from: string, to: string, allowed: Record<string, string[]>, entity: string,
) {
  const next = allowed[from] ?? [];
  if (!next.includes(to)) {
    throw new HttpError(409, `${entity} cannot move from ${from} to ${to}. Allowed: ${next.join(", ") || "none"}`);
  }
}
