/**
 * The 32-step clinical end-to-end scenario.
 *
 * Two hospitals are created from scratch, staffed with different roles, loaded
 * from a spreadsheet, and then driven through the whole patient journey:
 * admission → bed → vitals → encounter → diagnosis → prescription → lab order →
 * sample → result → verification → transfer → discharge. It finishes by
 * attempting a cross-tenant read and by restarting the read path to prove
 * persistence.
 *
 * Run with the app already serving on BASE (default http://localhost:3100).
 */

import ExcelJS from "exceljs";

import { signIn } from "./signin.mjs";

const BASE = process.env.BASE ?? "http://localhost:3100";

let passed = 0;
let failed = 0;
const failures = [];
let group = "";

function section(name) {
  group = name;
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    failures.push(`${group} → ${name}${detail ? ` (${detail})` : ""}`);
    console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ` — ${detail}` : ""}`);
  }
}

function client() {
  let cookie = "";
  return {
    async req(path, init = {}) {
      const res = await fetch(BASE + path, {
        ...init,
        headers: {
          ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(init.headers ?? {}),
        },
        redirect: "manual",
      });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        if (pair.startsWith("hos_session=")) cookie = pair;
      }
      const ct = res.headers.get("content-type") ?? "";
      const body = ct.includes("application/json")
        ? await res.json().catch(() => ({}))
        : ct.includes("spreadsheet") || ct.includes("octet-stream")
          ? Buffer.from(await res.arrayBuffer())
          : await res.text();
      return { status: res.status, ok: res.ok, body, headers: res.headers };
    },
    json(path, method, payload) {
      return this.req(path, { method, body: payload === undefined ? undefined : JSON.stringify(payload) });
    },
    form(path, formData) {
      return this.req(path, { method: "POST", body: formData });
    },
  };
}

const uniq = Date.now().toString(36);
const PW = "Sup3rSecret!2026";

async function signupHospital(name, city) {
  const c = client();
  const email = `admin.${name.toLowerCase().replace(/\W/g, "")}.${uniq}@example.test`;
  const res = await c.json("/api/auth/signup", "POST", {
    hospitalName: name, adminName: `Admin ${name}`, city, email, password: PW,
  });
  if (!res.ok) throw new Error(`signup failed: ${JSON.stringify(res.body)}`);
  // Complete onboarding so the workspace is provisioned with wards and beds.
  await c.json("/api/onboarding", "POST", {
    answers: {
      goal: "everything", hospitalName: name, city, beds: 40,
      departments: ["General Medicine", "Orthopaedics", "Cardiology"],
      doctors: [{ name: "Dr. Test Consultant", speciality: "General Medicine", fee: 600, slot: 15 }],
      languages: ["en", "hi"],
      features: [
        "ai_receptionist", "followup_agent", "call_recording", "doctor_crm", "care_queue", "escalation",
        "appointments", "ipd", "ot", "labs", "pharmacy", "emergency", "billing", "messaging", "portal",
        "data_io", "analytics", "integrations",
      ],
      storage: { driver: "local" },
      voiceProvider: "simulator", mainLineNumber: "+912040001111",
    },
  });
  return { client: c, email };
}

async function addStaff(admin, role, label) {
  const email = `${role}.${uniq}.${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await admin.json("/api/users", "POST", { name: label, email, role, password: PW });
  return { email, res };
}

async function login(email) {
  const c = client();
  /* These are real hospitals, so staff owe a second factor at sign-in.
     signIn enrols an authenticator the first time and produces a code
     thereafter, exactly as the person would. See tests/signin.mjs. */
  const res = await signIn(c, email, PW);
  return { client: c, res };
}

/* ------------------------------------------------------------------ */

console.log(`\x1b[1mClinical end-to-end scenario\x1b[0m  ${BASE}\n`);

/* 1 & 2 — two hospitals */
section("1–2. Create Hospital A and Hospital B");
const A = await signupHospital(`Testcare A ${uniq}`, "Pune");
const B = await signupHospital(`Testcare B ${uniq}`, "Nashik");
const bootA = await A.client.req("/api/bootstrap");
const bootB = await B.client.req("/api/bootstrap");
check("Hospital A provisioned", bootA.body.org?.id, JSON.stringify(bootA.body.org ?? {}));
check("Hospital B provisioned", bootB.body.org?.id);
check("A and B are different tenants", bootA.body.org?.id !== bootB.body.org?.id);
const orgA = bootA.body.org.id;

/* 3 — staff with different roles */
section("3. Create staff with different roles");
const roles = [
  ["doctor", "Dr. Asha Doctor"],
  ["nurse", "Nita Nurse"],
  ["receptionist", "Riya Reception"],
  ["lab_tech", "Lalit Lab"],
];
const staff = {};
for (const [role, label] of roles) {
  const { email, res } = await addStaff(A.client, role, label);
  check(`${role} invited`, res.ok, JSON.stringify(res.body).slice(0, 160));
  const session = await login(email);
  check(`${role} can sign in`, session.res.ok, JSON.stringify(session.res.body).slice(0, 160));
  staff[role] = session.client;
}

/* 4 — download the template */
section("4. Download the patient import template");
const tpl = await A.client.req("/api/import/template");
check("template downloads", tpl.ok && Buffer.isBuffer(tpl.body) && tpl.body.length > 4000, `status ${tpl.status}`);
const tplWb = new ExcelJS.Workbook();
if (Buffer.isBuffer(tpl.body)) await tplWb.xlsx.load(tpl.body);
check("template has PATIENTS and ADMISSIONS sheets",
  Boolean(tplWb.getWorksheet("PATIENTS") && tplWb.getWorksheet("ADMISSIONS")));

/* 5 — build a spreadsheet using the hospital's OWN headings, not ours */
section("5. Populate multiple patient rows (with a legacy hospital's own headings)");
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("PATIENTS");
ws.addRow(["Patient ID", "Patient Name", "Birth Date", "Sex", "Phone Number", "Blood", "Email ID", "Pin Code", "Allergies", "Known Cases"]);
const rows = [
  ["HIS-A1", "Rahul Anil Shinde", "1980-05-12", "M", "9822000011", "O positive", "rahul@example.test", "411001", "Penicillin", "Hypertension"],
  ["HIS-A2", "Sunita Devi Rao", "12/08/1975", "Female", "9822000012", "B+", "", "411002", "", "Type 2 Diabetes"],
  ["HIS-A3", "Imran Khan", "1992-02-29", "Male", "9822000013", "AB-", "imran@example.test", "411003", "", ""],
  ["HIS-A4", "Bad Mobile Person", "1988-01-01", "M", "12345", "A+", "", "411004", "", ""],
  ["HIS-A5", "Future Baby", "2099-01-01", "F", "9822000015", "A+", "", "411005", "", ""],
  ["HIS-A6", "Wrong Blood", "1970-07-07", "M", "9822000016", "Z+", "", "411006", "", ""],
  ["HIS-A7", "Bad Email", "1965-03-03", "F", "9822000017", "O-", "not-an-email", "411007", "", ""],
  ["HIS-A1", "Rahul Anil Shinde", "1980-05-12", "M", "9822000011", "O+", "", "411001", "", ""],
];
for (const r of rows) ws.addRow(r);
const wsA = wb.addWorksheet("ADMISSIONS");
wsA.addRow(["Patient ID", "IPD No", "Date of Admission", "Type of Admission", "Dept", "Under Dr", "Ward Name", "Bed No", "Complaint"]);
wsA.addRow(["HIS-A2", "IP-001", "2026-09-01", "Emergency", "General Medicine", "Dr. Test Consultant", "", "", "Uncontrolled sugars"]);
const xlsxBuf = Buffer.from(await wb.xlsx.writeBuffer());

/* 6 & 7 — upload, automatic header mapping */
section("6–7. Upload and verify automatic header mapping");
const fd = new FormData();
fd.append("file", new Blob([xlsxBuf]), "legacy-patients.xlsx");
const up = await A.client.form("/api/import", fd);
check("upload accepted", up.ok, JSON.stringify(up.body).slice(0, 200));
const map = up.body.mapping?.PATIENTS ?? {};
check("'Patient Name' → fullName", map["Patient Name"] === "fullName", JSON.stringify(map));
check("'Phone Number' → mobile", map["Phone Number"] === "mobile");
check("'Birth Date' → dateOfBirth", map["Birth Date"] === "dateOfBirth");
check("'Sex' → gender", map["Sex"] === "gender");
check("'Pin Code' → pin", map["Pin Code"] === "pin");
check("'Known Cases' → existingConditions", map["Known Cases"] === "existingConditions");
check("ADMISSIONS 'Under Dr' → doctor", up.body.mapping?.ADMISSIONS?.["Under Dr"] === "doctor");

/* 8 — validation errors surfaced per row */
section("8. Preview shows row-level validation errors");
const preview = up.body.patientRows ?? [];
const errFor = (ext) => preview.find((r) => r.normalized.externalId === ext)?.errors ?? [];
check("invalid mobile is rejected", errFor("HIS-A4").some((e) => /mobile/i.test(e.field)), JSON.stringify(errFor("HIS-A4")));
check("future DOB is rejected", errFor("HIS-A5").some((e) => /future/i.test(e.message)), JSON.stringify(errFor("HIS-A5")));
check("unknown blood group is rejected", errFor("HIS-A6").some((e) => /blood/i.test(e.field)), JSON.stringify(errFor("HIS-A6")));
check("invalid email is rejected", errFor("HIS-A7").some((e) => /email/i.test(e.field)), JSON.stringify(errFor("HIS-A7")));
check("valid rows counted", up.body.summary.validRows >= 3, JSON.stringify(up.body.summary));
check("nothing written before commit", (await A.client.req("/api/patients?q=Rahul")).body.total === 0);

/* 9 — duplicate detection inside the file */
section("9. Detect duplicate patient");
const dupRow = preview.filter((r) => r.normalized.externalId === "HIS-A1");
check("repeated External_Patient_ID flagged", dupRow.some((r) => r.errors.some((e) => /Duplicated in this file/i.test(e.message))),
  JSON.stringify(dupRow.map((r) => r.errors)));

/* 10 — commit */
section("10. Import valid patients");
const batchId = up.body.batchId;
const commit = await A.client.json(`/api/import/${batchId}`, "POST", { conflictPolicy: "keep_existing" });
check("commit succeeded", commit.ok, JSON.stringify(commit.body).slice(0, 200));
check("3 patients created", commit.body.created === 3, `created=${commit.body.created}`);
check("5 rows rejected (4 invalid + 1 in-file duplicate)", commit.body.failed === 5, `failed=${commit.body.failed}`);
check("1 admission created from the ADMISSIONS sheet", commit.body.admissionsCreated === 1, `adm=${commit.body.admissionsCreated}`);
const errCsv = await A.client.req(`/api/import/${batchId}/errors`);
check("error report downloads", errCsv.ok && String(errCsv.body).includes("Invalid mobile"), String(errCsv.body).slice(0, 120));

section("10b. A second import from the same hospital reuses the remembered mapping");
const fd2 = new FormData();
fd2.append("file", new Blob([xlsxBuf]), "legacy-patients-again.xlsx");
const up2 = await A.client.form("/api/import", fd2);
check("mapping remembered", up2.body.mapping?.PATIENTS?.["Phone Number"] === "mobile");
check("existing patients detected as duplicates",
  up2.body.summary.duplicateRows >= 3, JSON.stringify(up2.body.summary));

/* 11 — open the imported patient */
section("11. Open an imported patient profile");
const found = await A.client.req("/api/patients?q=Rahul");
check("patient is searchable", found.body.total === 1, JSON.stringify(found.body.total));
const patientId = found.body.items[0]?.id;
const profile = await A.client.req(`/api/patients/${patientId}`);
check("profile loads", profile.ok);
check("age derived from DOB, not stored", profile.body.patient.age === new Date().getUTCFullYear() - 1980 - (new Date() < new Date(`${new Date().getUTCFullYear()}-05-12`) ? 1 : 0),
  `age=${profile.body.patient.age}`);
check("UHID generated", /^UH\d{10}$/.test(profile.body.patient.uhid), profile.body.patient.uhid);
check("allergy imported as a structured record", profile.body.allergies.some((a) => a.substance === "Penicillin"));
check("condition imported as a diagnosis", profile.body.diagnoses.some((d) => /Hypertension/.test(d.description)));
check("timeline has a registration event", profile.body.timeline.some((e) => e.kind === "import" || e.kind === "registration"));

/* 12 & 13 — admission and bed */
section("12–13. Create admission and assign an available bed");
const bedsRes = await A.client.req("/api/beds");
const freeBeds = (bedsRes.body.items ?? []).filter((b) => b.status === "AVAILABLE");
check("ward/bed inventory provisioned", freeBeds.length > 2, `free=${freeBeds.length}`);
const bed1 = freeBeds[0];
const bed2 = freeBeds[1];

const adm = await staff.doctor.json("/api/admissions", "POST", {
  patientId, type: "elective", reason: "Chest pain for evaluation", bedId: bed1.id,
});
check("admission created", adm.ok, JSON.stringify(adm.body).slice(0, 200));
const admissionId = adm.body.admission?.id;
check("admission number issued", /^IP\d{9}$/.test(adm.body.admission?.admissionNo ?? ""), adm.body.admission?.admissionNo);
check("admission holds the bed, patient does not", adm.body.admission?.currentWard?.bedId === bed1.id);

/* 14 — bed becomes occupied */
section("14. Verify the bed became occupied");
const afterAssign = await A.client.req("/api/beds");
const bed1After = afterAssign.body.items.find((b) => b.id === bed1.id);
check("bed status OCCUPIED", bed1After.status === "OCCUPIED", bed1After.status);
check("bed shows its occupant", bed1After.occupant?.patientId === patientId);

section("14b. A bed cannot be double-booked (race + constraint)");
const found2 = await A.client.req("/api/patients?q=Sunita");
const patient2 = found2.body.items[0];
// Sunita already has an admission from the import — discharge is required first.
const dupAdm = await staff.doctor.json("/api/admissions", "POST", { patientId: patient2.id, bedId: bed2.id });
check("second active admission for the same patient refused", dupAdm.status === 409, `status ${dupAdm.status}`);

const found3 = await A.client.req("/api/patients?q=Imran");
const patient3 = found3.body.items[0];
const raceARes = await staff.nurse.json("/api/admissions", "POST", { patientId: patient3.id, bedId: bed1.id });
check("occupied bed refused to a second patient", raceARes.status === 409, `status ${raceARes.status} ${JSON.stringify(raceARes.body).slice(0, 120)}`);

section("14c. Two staff claiming the same free bed at the same instant");
// A genuine race: both requests are in flight before either completes.
const raceBed = freeBeds[2];
// Two fresh patients so the race is not confounded by existing admissions.
const twoPatients = [];
for (const n of ["RaceOne", "RaceTwo"]) {
  const r = await A.client.json("/api/patients", "POST", {
    firstName: n, lastName: "Contender", dateOfBirth: "1990-01-01", gender: "male",
    mobile: `98765${Math.floor(10000 + Math.random() * 89999)}`.slice(0, 15),
  });
  if (r.body.patient) twoPatients.push(r.body.patient);
}
if (twoPatients.length === 2) {
  const [r1, r2] = await Promise.all([
    staff.nurse.json("/api/admissions", "POST", { patientId: twoPatients[0].id, bedId: raceBed.id }),
    staff.doctor.json("/api/admissions", "POST", { patientId: twoPatients[1].id, bedId: raceBed.id }),
  ]);
  const winners = [r1, r2].filter((r) => r.ok).length;
  const losers = [r1, r2].filter((r) => r.status === 409).length;
  check("exactly one of the two concurrent claims succeeds", winners === 1 && losers === 1,
    `ok=${winners} conflict=${losers} statuses ${r1.status}/${r2.status}`);

  const raceBedAfter = (await A.client.req("/api/beds")).body.items.find((b) => b.id === raceBed.id);
  check("the bed holds exactly one occupant afterwards", raceBedAfter.status === "OCCUPIED" && Boolean(raceBedAfter.occupant));
  const activeOnBed = (await A.client.req("/api/admissions?status=ACTIVE")).body.items
    .filter((a) => a.currentWard?.bedId === raceBed.id).length;
  check("only one active admission references that bed", activeOnBed === 1, `count=${activeOnBed}`);
} else {
  check("exactly one of the two concurrent claims succeeds", false, "not enough unadmitted patients to race");
}

/* 15 — vitals */
section("15. Enter vitals");
const v1 = await staff.nurse.json(`/api/patients/${patientId}/vitals`, "POST", {
  systolic: 148, diastolic: 92, pulse: 96, spo2: 97, temperatureC: 37.4, respiratoryRate: 18,
  heightCm: 172, weightKg: 78, painScore: 4, admissionId,
});
check("vitals recorded", v1.ok, JSON.stringify(v1.body).slice(0, 200));
check("BMI derived", v1.body.vitals?.bmi > 20 && v1.body.vitals?.bmi < 35, String(v1.body.vitals?.bmi));
const badVitals = await staff.nurse.json(`/api/patients/${patientId}/vitals`, "POST", { systolic: 90, diastolic: 120 });
check("diastolic above systolic rejected", badVitals.status === 422, `status ${badVitals.status}`);
const badTemp = await staff.nurse.json(`/api/patients/${patientId}/vitals`, "POST", { temperatureC: 61 });
check("impossible temperature rejected", badTemp.status === 422, `status ${badTemp.status}`);
const recepVitals = await staff.receptionist.json(`/api/patients/${patientId}/vitals`, "POST", { pulse: 80 });
check("reception cannot record vitals", recepVitals.status === 403, `status ${recepVitals.status}`);

/* 16 — encounter */
section("16. Create a doctor encounter");
const enc = await staff.doctor.json("/api/encounters", "POST", {
  patientId, type: "ipd", admissionId,
  chiefComplaint: "Central chest discomfort for 2 days",
  hpi: "Exertional, relieved by rest. No radiation.",
  pastHistory: "Hypertension on amlodipine",
  examination: "CVS: S1 S2 normal. Chest clear.",
  assessment: "Stable angina, rule out ACS",
  plan: "Admit, serial troponin, cardiology opinion",
});
check("encounter created", enc.ok, JSON.stringify(enc.body).slice(0, 200));
const encounterId = enc.body.encounter?.id;
check("encounter number issued", /^EN\d{10}$/.test(enc.body.encounter?.encounterNo ?? ""));

const amend = await staff.doctor.json(`/api/encounters/${encounterId}`, "PATCH", {
  assessment: "Stable angina — troponin negative", reason: "Result available",
});
check("encounter amended", amend.ok && amend.body.encounter.version === 2, `v=${amend.body.encounter?.version}`);
const encFull = await staff.doctor.req(`/api/encounters/${encounterId}`);
check("previous version retained", encFull.body.versions?.length === 1 &&
  /rule out ACS/.test(encFull.body.versions[0].snapshot.assessment), JSON.stringify(encFull.body.versions?.length));
const nurseEnc = await staff.nurse.json("/api/encounters", "POST", { patientId, type: "opd" });
check("nurse cannot write an encounter", nurseEnc.status === 403, `status ${nurseEnc.status}`);

/* 17 — diagnosis */
section("17. Add a diagnosis");
const dx = await staff.doctor.json(`/api/patients/${patientId}/diagnoses`, "POST", {
  description: "Stable angina pectoris", code: "I20.9", codeSystem: "ICD-10",
  category: "final", rank: "primary", encounterId, admissionId,
});
check("diagnosis added", dx.ok, JSON.stringify(dx.body).slice(0, 200));

/* 18 — prescription */
section("18. Add a prescription");
const rx = await staff.doctor.json(`/api/patients/${patientId}/medications`, "POST", {
  medicine: "Aspirin", genericName: "Acetylsalicylic acid", strength: "75 mg", form: "tablet",
  dose: "1 tablet", route: "oral", frequency: "once daily", timing: "after food",
  durationDays: 30, instructions: "Stop and call if black stools", encounterId, admissionId,
});
check("prescription structured, not free text", rx.ok && rx.body.medication?.frequency === "once daily",
  JSON.stringify(rx.body).slice(0, 200));
check("end date derived from duration", Boolean(rx.body.medication?.endDate));

const allergic = await staff.doctor.json(`/api/patients/${patientId}/medications`, "POST", {
  medicine: "Penicillin V", dose: "500 mg", frequency: "twice daily",
});
check("allergy warning blocks until overridden", allergic.status === 409 && /Recorded allergy/i.test(allergic.body.error ?? ""),
  `status ${allergic.status} ${allergic.body.error ?? ""}`);
const overridden = await staff.doctor.json(`/api/patients/${patientId}/medications`, "POST", {
  medicine: "Penicillin V", dose: "500 mg", frequency: "twice daily",
  allergyOverrideReason: "Documented mild rash only; benefit outweighs risk, discussed with patient",
});
check("prescriber can override with a recorded reason", overridden.ok, JSON.stringify(overridden.body).slice(0, 160));
const nurseRx = await staff.nurse.json(`/api/patients/${patientId}/medications`, "POST", {
  medicine: "Paracetamol", dose: "500 mg", frequency: "TDS",
});
check("nurse cannot prescribe", nurseRx.status === 403, `status ${nurseRx.status}`);

/* 19 — lab order */
section("19. Order a laboratory test");
const catalog = await staff.doctor.req("/api/lab/catalog");
check("lab catalogue available", (catalog.body.items ?? []).length >= 8, String(catalog.body.items?.length));
const cbc = catalog.body.items.find((t) => t.code === "CBC");
check("CBC has structured analytes with ranges",
  cbc?.analytes?.some((a) => a.code === "HB" && a.refLow === 12 && a.refHigh === 16));

const order = await staff.doctor.json("/api/lab/orders", "POST", {
  patientId, testCodes: ["CBC"], priority: "urgent", clinicalNote: "Rule out anaemia", encounterId, admissionId,
});
check("lab order created", order.ok, JSON.stringify(order.body).slice(0, 200));
const orderId = order.body.order?.id;
check("order starts as ORDERED", order.body.order?.status === "ORDERED");

const earlyResult = await staff.lab_tech.json(`/api/lab/orders/${orderId}`, "POST", {
  action: "results", entries: [{ analyteCode: "HB", value: "11" }],
});
check("cannot enter results before the sample is collected", earlyResult.status === 409, `status ${earlyResult.status}`);

/* 20 — sample collection */
section("20. Collect the sample");
const collect = await staff.nurse.json(`/api/lab/orders/${orderId}`, "POST", { action: "collect" });
check("sample collected", collect.ok && collect.body.order.status === "SAMPLE_COLLECTED", JSON.stringify(collect.body).slice(0, 160));
check("sample id issued", Boolean(collect.body.order?.sampleId));

/* 21 — result entry */
section("21. Enter results");
await staff.lab_tech.json(`/api/lab/orders/${orderId}`, "POST", { action: "process" });
const results = await staff.lab_tech.json(`/api/lab/orders/${orderId}`, "POST", {
  action: "results",
  entries: [
    { analyteCode: "HB", value: "6.4" },
    { analyteCode: "WBC", value: "9.2" },
    { analyteCode: "PLT", value: "120" },
  ],
});
check("results entered", results.ok, JSON.stringify(results.body).slice(0, 200));
const hb = results.body.order.results.find((r) => r.analyteCode === "HB");
const plt = results.body.order.results.find((r) => r.analyteCode === "PLT");
const wbc = results.body.order.results.find((r) => r.analyteCode === "WBC");
check("critically low haemoglobin flagged CRITICAL_LOW", hb?.flag === "CRITICAL_LOW", hb?.flag);
check("low platelets flagged LOW", plt?.flag === "LOW", plt?.flag);
check("normal WBC flagged NORMAL", wbc?.flag === "NORMAL", wbc?.flag);
check("flags are stored, not just coloured", typeof hb?.flag === "string" && hb.unit === "g/dL");

const crit = await A.client.req("/api/lab/critical?status=PENDING");
check("critical result opened a tracked notification",
  (crit.body.items ?? []).some((n) => n.orderId === orderId && n.flag === "CRITICAL_LOW"),
  JSON.stringify(crit.body.items?.length));

/* 22 — verification */
section("22. Verify the result");
const nurseVerify = await staff.nurse.json(`/api/lab/orders/${orderId}`, "POST", { action: "verify" });
check("nurse cannot verify results", nurseVerify.status === 403, `status ${nurseVerify.status}`);
const verify = await staff.lab_tech.json(`/api/lab/orders/${orderId}`, "POST", { action: "verify" });
check("verified by an authorised user", verify.ok && verify.body.order.status === "VERIFIED", JSON.stringify(verify.body).slice(0, 160));
check("verifier recorded", Boolean(verify.body.order?.verifiedBy));
check("result lines marked FINAL", verify.body.order.results.every((r) => r.status === "FINAL" || r.status === "AMENDED"));

section("22b. A verified result cannot be quietly edited");
const silentEdit = await staff.lab_tech.json(`/api/lab/orders/${orderId}`, "POST", {
  action: "results", entries: [{ analyteCode: "HB", value: "12.9" }],
});
check("amendment without a reason refused", silentEdit.status === 409, `status ${silentEdit.status}`);
const amendRes = await staff.lab_tech.json(`/api/lab/orders/${orderId}`, "POST", {
  action: "results", entries: [{ analyteCode: "HB", value: "6.6" }],
  amendReason: "Re-run on a fresh sample — original sample haemolysed",
});
check("amendment with a reason accepted", amendRes.ok, JSON.stringify(amendRes.body).slice(0, 160));
const amendedHb = amendRes.body.order.results.find((r) => r.analyteCode === "HB");
check("amended result versioned", amendedHb?.version === 2 && amendedHb?.status === "AMENDED",
  `v${amendedHb?.version} ${amendedHb?.status}`);

/* 23 — timeline */
section("23. Confirm the result appears on the patient timeline");
const timeline = (await A.client.req(`/api/patients/${patientId}`)).body.timeline ?? [];
check("lab order on the timeline", timeline.some((e) => e.kind === "lab_order"));
check("lab result on the timeline", timeline.some((e) => e.kind === "lab_result"));
check("critical result on the timeline", timeline.some((e) => e.kind === "lab_critical" && e.severity === "critical"));
check("timeline items link to their record", timeline.filter((e) => e.entityId).length > 4);
check("admission, vitals, encounter, diagnosis and prescription all present",
  ["admission", "vitals", "encounter", "diagnosis", "prescription"].every((k) => timeline.some((e) => e.kind === k)),
  timeline.map((e) => e.kind).join(","));

/* 24 & 25 — transfer */
section("24–25. Transfer to another bed and confirm the first is released");
const noReason = await staff.nurse.json(`/api/admissions/${admissionId}`, "POST", { action: "transfer", toBedId: bed2.id });
check("transfer without a reason refused", noReason.status === 422, `status ${noReason.status}`);
const transfer = await staff.nurse.json(`/api/admissions/${admissionId}`, "POST", {
  action: "transfer", toBedId: bed2.id, reason: "Needs cardiac monitoring", authorizedBy: "Dr. Test Consultant",
});
check("transfer succeeded", transfer.ok, JSON.stringify(transfer.body).slice(0, 200));
check("admission now on the destination bed", transfer.body.admission?.currentWard?.bedId === bed2.id);

const bedsNow = (await A.client.req("/api/beds")).body.items;
check("origin bed released to CLEANING", bedsNow.find((b) => b.id === bed1.id)?.status === "CLEANING",
  bedsNow.find((b) => b.id === bed1.id)?.status);
check("destination bed OCCUPIED", bedsNow.find((b) => b.id === bed2.id)?.status === "OCCUPIED");

const history = (await A.client.req(`/api/admissions/${admissionId}`)).body.wardHistory ?? [];
check("both ward assignments retained", history.length === 2, `n=${history.length}`);
check("first assignment closed with a timestamp", history[0].status === "CLOSED" && Boolean(history[0].toAt));
check("transfer reason and authoriser preserved",
  history[1].transferReason === "Needs cardiac monitoring" && history[1].authorizedBy === "Dr. Test Consultant");

/* 26 & 27 — discharge */
section("26–27. Discharge and confirm the bed is released");
const noSummary = await staff.doctor.json(`/api/admissions/${admissionId}`, "POST", {
  action: "discharge", finalDiagnosis: "Stable angina",
});
check("discharge without a summary refused", noSummary.status === 422, `status ${noSummary.status}`);

const discharge = await staff.doctor.json(`/api/admissions/${admissionId}`, "POST", {
  action: "discharge",
  finalDiagnosis: "Stable angina pectoris; iron deficiency anaemia",
  dischargeSummary: "Admitted with chest pain. Troponin negative. Anaemia identified and treated. Stable at discharge.",
  instructions: "Continue aspirin. Iron supplements. Review in 2 weeks.",
  followupDate: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
});
check("discharge succeeded", discharge.ok, JSON.stringify(discharge.body).slice(0, 200));
check("admission is DISCHARGED, not deleted", discharge.body.admission?.status === "DISCHARGED");
check("discharge timestamp recorded", Boolean(discharge.body.admission?.dischargedAt));

const bedsAfterDischarge = (await A.client.req("/api/beds")).body.items;
check("bed released per the business rule (CLEANING)",
  bedsAfterDischarge.find((b) => b.id === bed2.id)?.status === "CLEANING",
  bedsAfterDischarge.find((b) => b.id === bed2.id)?.status);
check("released bed has no occupant", !bedsAfterDischarge.find((b) => b.id === bed2.id)?.occupant);

const cleaned = await A.client.json(`/api/beds/${bed2.id}`, "PATCH", { status: "AVAILABLE" });
check("housekeeping can return the bed to AVAILABLE", cleaned.ok && cleaned.body.bed.status === "AVAILABLE");

/* 28 — history remains */
section("28. Confirm the complete history remains visible");
const finalProfile = (await A.client.req(`/api/patients/${patientId}`)).body;
check("admission history retained", finalProfile.admissions.length >= 1);
check("encounter retained", finalProfile.encounters.length >= 1);
check("vitals retained", finalProfile.vitals.length >= 1);
check("lab order retained with results", finalProfile.labOrders.length >= 1 && finalProfile.labOrders[0].results.length === 3);
check("medications retained", finalProfile.medications.length >= 2);
check("timeline includes discharge", finalProfile.timeline.some((e) => e.kind === "discharge"));
check("clinical audit recorded with before/after",
  finalProfile.audit.some((a) => a.action === "admission.transferred" && a.before && a.after),
  JSON.stringify(finalProfile.audit.slice(0, 2)).slice(0, 200));

/* 29 & 30 — cross-tenant */
section("29–30. Hospital B must not reach Hospital A's records");
const attempts = [
  ["read patient", await B.client.req(`/api/patients/${patientId}`)],
  ["read admission", await B.client.req(`/api/admissions/${admissionId}`)],
  ["read encounter", await B.client.req(`/api/encounters/${encounterId}`)],
  ["read lab order", await B.client.req(`/api/lab/orders/${orderId}`)],
  ["read import batch", await B.client.req(`/api/import/${batchId}`)],
  ["patch patient", await B.client.json(`/api/patients/${patientId}`, "PATCH", { firstName: "Hacked" })],
  ["record vitals", await B.client.json(`/api/patients/${patientId}/vitals`, "POST", { pulse: 70 })],
  ["transfer admission", await B.client.json(`/api/admissions/${admissionId}`, "POST", { action: "transfer", toBedId: bed1.id, reason: "x", authorizedBy: "x" })],
  ["enter lab results", await B.client.json(`/api/lab/orders/${orderId}`, "POST", { action: "results", entries: [{ analyteCode: "HB", value: "1" }] })],
  ["patch bed", await B.client.json(`/api/beds/${bed1.id}`, "PATCH", { status: "MAINTENANCE" })],
];
for (const [label, res] of attempts) {
  check(`B cannot ${label}`, res.status === 404 || res.status === 403, `status ${res.status}`);
}
const bList = await B.client.req("/api/patients?q=Rahul");
check("B's patient search cannot see A's patients", bList.body.total === 0, String(bList.body.total));
check("A's patient is untouched", (await A.client.req(`/api/patients/${patientId}`)).body.patient.firstName === "Rahul");

section("30b. Duplicate detection does not cross hospitals");
const fdB = new FormData();
fdB.append("file", new Blob([xlsxBuf]), "same-file.xlsx");
const upB = await B.client.form("/api/import", fdB);
check("the same people are new patients in Hospital B", upB.body.summary.duplicateRows === 0, JSON.stringify(upB.body.summary));

section("30c. The generic record API can no longer write clinical entities");
const legacyWrite = await A.client.json("/api/records/patient", "POST", { name: "Bypass Attempt", age: 40 });
check("POST /api/records/patient refused", legacyWrite.status === 409, `status ${legacyWrite.status}`);
const legacyDelete = await A.client.req(`/api/records/patient/${patientId}`, { method: "DELETE" });
check("DELETE /api/records/patient refused", legacyDelete.status === 409, `status ${legacyDelete.status}`);

section("30d. A SaaS super admin does not inherit clinical access");
const saClient = client();
const saRes = await saClient.json("/api/auth/login", "POST", { email: "mayur@hospitalai.os", password: "demo1234" });
const sa = { client: saClient, res: saRes };
if (sa.res.ok) {
  const saMe = await sa.client.req("/api/auth/me");
  const perms = saMe.body.user?.permissions ?? [];
  check("super admin has no patients.clinical.view",
    !perms.includes("patients.clinical.view"), JSON.stringify(perms).slice(0, 200));
  check("super admin has no prescriptions.write", !perms.includes("prescriptions.write"));
} else {
  check("super admin demo account available", false, "could not sign in with the demo password");
}

/* 31 — persistence */
section("31. Persistence across a fresh session");
const fresh = await login(A.email);
check("fresh sign-in works", fresh.res.ok);
const freshProfile = await fresh.client.req(`/api/patients/${patientId}`);
check("patient still present after re-login", freshProfile.body.patient?.uhid === finalProfile.patient.uhid);
check("labs still present", freshProfile.body.labOrders.length >= 1);
check("ward history still present", (await fresh.client.req(`/api/admissions/${admissionId}`)).body.wardHistory.length === 2);

/* ------------------------------------------------------------------ */
console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed ? 1 : 0);
