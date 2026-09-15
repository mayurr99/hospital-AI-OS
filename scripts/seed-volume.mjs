/**
 * Volume seeder — for load testing only, never for production.
 *
 * Fills one tenant with a year of a mid-sized hospital's data so the load probe
 * measures the shape of the queries rather than the speed of an empty table.
 *
 *   node scripts/seed-volume.mjs [orgId] [patients]
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const DB = process.env.DATABASE_FILE ?? path.join(process.cwd(), ".data", "hospital-ai-os.db");
const ORG = process.argv[2] ?? "org_democare";
const N_PATIENTS = Number(process.argv[3] ?? 8000);

const d = new DatabaseSync(DB);
d.exec("PRAGMA journal_mode = WAL");

/*
 * Names and numbers are deliberately marked as synthetic.
 *
 * This seeder exists to make the load probe meaningful, and it shares a database
 * with the functional suites. Realistic-looking names and phone numbers in the
 * same space as the tests' own data make the product's duplicate detection fire
 * on them — correctly, but it means a test that imports a patient finds it
 * merged into a synthetic one instead of created. Load-test rows therefore carry
 * a visible marker and phone numbers from a reserved block.
 */
const FIRST = ["Aarav","Vivaan","Aditya","Arjun","Sai","Reyansh","Krishna","Ishaan","Rohan","Kabir","Ananya","Diya","Aadhya","Kiara","Saanvi","Myra","Anika","Navya","Prisha","Riya","Sunita","Mahesh","Prakash","Lata","Ganesh","Vaishali","Nitin","Shweta","Ramesh","Pooja"];
const LAST = ["Patil","Deshmukh","Kulkarni","Jadhav","Shinde","Pawar","More","Gaikwad","Joshi","Kale","Chavan","Sawant","Bhosale","Naik","Rane","Salunkhe","Thorat","Mane","Nikam","Shelke"];
/** Appended to every seeded surname so these rows are obvious and never match real ones. */
const MARKER = "Loadtest";
const CITY = [["Pune","Maharashtra"],["Nashik","Maharashtra"],["Nagpur","Maharashtra"],["Satara","Maharashtra"],["Kolhapur","Maharashtra"]];
const LANG = ["mr","hi","en"];
const BLOOD = ["A+","B+","O+","AB+","A-","O-"];
const RISK = ["green","green","green","amber","red"];

const pick = (a, i) => a[i % a.length];
const iso = (d) => d.toISOString();
const now = new Date();
const daysAgo = (n) => new Date(now.getTime() - n * 86400000);

const existing = d.prepare("SELECT count(*) c FROM patients WHERE org_id = ?").get(ORG).c;
console.log(`tenant ${ORG}: ${existing} patients before`);

/*
 * Load-test rows live in their own UHID namespace.
 *
 * The application allocates UHIDs from a per-hospital counter (UH<year><n>).
 * Deriving seeded UHIDs from the current maximum put them in the counter's
 * *future* range, so the next patient registered through the UI collided with a
 * synthetic one and the hospital's own registration stopped working — the
 * product was right to refuse it. A separate prefix makes collision impossible
 * and makes these rows obvious in any export.
 */
const prefix = "LT";
let seq = d.prepare("SELECT count(*) c FROM patients WHERE org_id = ? AND uhid LIKE 'LT%'").get(ORG).c;

const insP = d.prepare(`INSERT INTO patients
  (id, org_id, uhid, first_name, last_name, date_of_birth, age_years, gender, mobile, email,
   blood_group, preferred_language, address_line, district, state, pin, risk, status, source,
   created_at, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active','seed',?,?)`);

const insO = d.prepare(`INSERT INTO lab_orders
  (id, org_id, patient_id, order_no, status, priority, ordered_by, ordered_at, specimen, critical, created_at, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);

const insR = d.prepare(`INSERT INTO lab_results
  (id, org_id, order_id, item_id, analyte_code, analyte_name, value_text, value_num, unit,
   ref_low, ref_high, flag, status, created_at, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

const insV = d.prepare(`INSERT INTO vitals
  (id, org_id, patient_id, recorded_at, recorded_by, pulse, systolic, diastolic, temperature_c, spo2, created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);

const ANALYTES = [
  ["HB", "Haemoglobin", "g/dL", 12, 16],
  ["WBC", "Total leucocyte count", "10^3/uL", 4, 11],
  ["PLT", "Platelet count", "10^3/uL", 150, 410],
  ["CREA", "Serum creatinine", "mg/dL", 0.6, 1.3],
  ["K", "Potassium", "mmol/L", 3.5, 5.1],
];
const STATUSES = ["ORDERED", "SAMPLE_COLLECTED", "PROCESSING", "RESULT_ENTERED", "VERIFIED", "RELEASED"];

const vitalsCols = d.prepare("PRAGMA table_info(vitals)").all().map((c) => c.name);
const canVitals = ["pulse", "systolic", "diastolic", "temperature_c", "spo2", "recorded_by"].every((c) => vitalsCols.includes(c));
if (!canVitals) console.log("  (vitals columns differ — skipping vitals)");

const started = Date.now();
d.exec("BEGIN IMMEDIATE");
const ids = [];
for (let i = 0; i < N_PATIENTS; i++) {
  seq++;
  const id = `pat_seed_${seq}_${Math.random().toString(36).slice(2, 8)}`;
  ids.push(id);
  const [city, state] = pick(CITY, i);
  const age = 4 + ((i * 7) % 82);
  const dob = new Date(now.getFullYear() - age, i % 12, ((i * 3) % 27) + 1);
  const created = iso(daysAgo((i * 13) % 365));
  insP.run(
    id, ORG, `${prefix}${String(seq).padStart(6, "0")}`,
    pick(FIRST, i), `${pick(LAST, i * 3 + 1)}${MARKER}`, iso(dob).slice(0, 10), age,
    /* 7000-block numbers, disjoint from the 9xxxx numbers the suites use. */
    i % 2 ? "male" : "female", `70${String(10000000 + (i % 89999999)).padStart(8, "0")}`,
    i % 5 === 0 ? `patient${seq}@example.in` : "",
    pick(BLOOD, i), pick(LANG, i), `${(i % 200) + 1}, Sector ${i % 30}`, city, state,
    String(411000 + (i % 60)), pick(RISK, i * 7), created, created,
  );
}
d.exec("COMMIT");
console.log(`  + ${N_PATIENTS} patients in ${Date.now() - started}ms`);

const N_ORDERS = Math.round(N_PATIENTS / 2);
const t2 = Date.now();
d.exec("BEGIN IMMEDIATE");
const maxO = d.prepare("SELECT count(*) c FROM lab_orders WHERE org_id = ?").get(ORG).c;
for (let i = 0; i < N_ORDERS; i++) {
  const oid = `lo_seed_${i}_${Math.random().toString(36).slice(2, 8)}`;
  const st = pick(STATUSES, i * 3);
  const at = iso(daysAgo((i * 5) % 200));
  insO.run(oid, ORG, pick(ids, i * 11), `LAB${String(maxO + i + 1).padStart(6, "0")}`, st,
    i % 9 === 0 ? "stat" : "routine", "Dr. Seed", at, "Blood", i % 23 === 0 ? 1 : 0, at, at);

  if (["RESULT_ENTERED", "VERIFIED", "RELEASED"].includes(st)) {
    for (let k = 0; k < 3; k++) {
      const [code, name, unit, lo, hi] = pick(ANALYTES, i + k);
      const v = +(lo + ((i * 13 + k * 7) % 100) / 100 * (hi - lo) * 1.4).toFixed(2);
      insR.run(`lr_seed_${i}_${k}`, ORG, oid, `item_${k}`, code, name, String(v), v, unit,
        lo, hi, v > hi ? "HIGH" : v < lo ? "LOW" : "NORMAL", st === "ORDERED" ? "PRELIMINARY" : "FINAL", at, at);
    }
  }
}
d.exec("COMMIT");
console.log(`  + ${N_ORDERS} lab orders (+results) in ${Date.now() - t2}ms`);

if (canVitals) {
  const t3 = Date.now();
  d.exec("BEGIN IMMEDIATE");
  const N_V = N_PATIENTS * 2;
  for (let i = 0; i < N_V; i++) {
    const at = iso(daysAgo((i * 3) % 120));
    insV.run(`vt_seed_${i}`, ORG, pick(ids, i * 7), at, "Seed Nurse",
      60 + (i % 45), 100 + (i % 55), 60 + (i % 30), +(36 + (i % 25) / 10).toFixed(1), 90 + (i % 10), at);
  }
  d.exec("COMMIT");
  console.log(`  + ${N_V} vitals in ${Date.now() - t3}ms`);
}

for (const t of ["patients", "lab_orders", "lab_results", "vitals"]) {
  try { console.log(`  ${t}: ${d.prepare(`SELECT count(*) c FROM ${t} WHERE org_id = ?`).get(ORG).c}`); } catch {}
}
d.exec("ANALYZE");
console.log("done.");
