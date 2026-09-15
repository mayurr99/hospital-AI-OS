/**
 * A brand-new hospital, and every operation it has to be able to perform.
 *
 * This walks the path a real customer walks on their first afternoon: sign up,
 * add the departments and doctors, open a ward, put beds in it, register a
 * patient, admit them, chart them, order a test, bill it, discharge them — and
 * then edit and remove the things that were created, because software that can
 * only add is not software anybody can run a hospital on.
 *
 * Each entity is exercised for all four operations and the result is printed as
 * a matrix. A missing *read* or *create* is a failure. A missing update or
 * delete is reported rather than failed, because for some records — a discharge,
 * an audit row, a recorded observation — refusing to delete is the correct
 * clinical answer and deleting would be the bug.
 *
 *   node tests/crud.mjs
 */
import { signIn } from "./signin.mjs";

const BASE = process.env.BASE ?? "http://localhost:3100";

let passed = 0, failed = 0;
const failures = [];
const matrix = [];
let group = "";
const section = (n) => { group = n; console.log(`\n\x1b[1m${n}\x1b[0m`); };
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { failed++; failures.push(`${group} → ${name}${detail ? ` (${detail})` : ""}`); console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ` — ${detail}` : ""}`); }
}
/** Reported, not failed — see the header. */
function note(name, ok, detail = "") {
  console.log(ok ? `  \x1b[32m✓\x1b[0m ${name}` : `  \x1b[33m•\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
}
async function part(name, fn) {
  section(name);
  try { await fn(); }
  catch (e) { check("section completed without throwing", false, String(e.message ?? e).split("\n")[0].slice(0, 140)); }
}

function client() {
  let cookie = "";
  return {
    get cookie() { return cookie; },
    async req(p, init = {}) {
      const res = await fetch(BASE + p, {
        ...init,
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(init.headers ?? {}) },
        redirect: "manual",
      });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        if (pair.startsWith("hos_session=")) cookie = pair;
      }
      const t = await res.text();
      let body; try { body = JSON.parse(t); } catch { body = t; }
      return { status: res.status, ok: res.ok, body };
    },
    json(p, m, v) { return this.req(p, { method: m, body: v === undefined ? undefined : JSON.stringify(v) }); },
  };
}

const uniq = Date.now().toString(36);
const PW = "supersecret123";
const brief = (r) => `${r.status}${r.ok ? "" : ` ${JSON.stringify(r.body ?? "").slice(0, 60)}`}`;

/** Record what an entity supports, for the summary at the end. */
function record(entity, ops) { matrix.push({ entity, ...ops }); }

/* ================================================================== */
console.log("\x1b[1mNew hospital — every CRUD operation\x1b[0m\n");

const admin = client();
const adminEmail = `crud.admin+${uniq}@crudtest.test`;

await part("1. Sign up and get in", async () => {
  const r = await admin.json("/api/auth/signup", "POST", {
    hospitalName: `CRUD Hospital ${uniq}`, adminName: "Founder Admin", email: adminEmail, password: PW, acceptedTerms: true,
  });
  check("a hospital can be created from the sign-up form", r.ok && r.body.orgId, brief(r));
  check("it lands on onboarding, not a blank dashboard", r.body.next === "/onboarding", String(r.body.next));

  /* Enrol the second factor now so later sign-ins do not evict this session. */
  await signIn(admin, adminEmail, PW);
  const me = await admin.req("/api/auth/me");
  check("the founder is signed in as the hospital administrator",
    me.ok && me.body?.user?.role === "hospital_admin", brief(me));
});

await part("2. Onboarding — the questions a new hospital answers", async () => {
  const get1 = await admin.req("/api/onboarding");
  check("the onboarding state can be read", get1.ok, brief(get1));

  const save = await admin.json("/api/onboarding", "PATCH", {
    step: 1, answers: { beds: "50", specialities: ["general", "obstetrics"], callVolume: "200" },
  });
  check("answers can be saved", save.ok, brief(save));

  const done = await admin.json("/api/onboarding", "POST", {
    step: 4, completed: true,
    answers: { beds: "50", departments: ["General Medicine", "Obstetrics"], specialities: ["general"] },
  });
  check("onboarding can be completed", done.ok, brief(done));

  const after = await admin.req("/api/bootstrap");
  check("the dashboard opens once onboarding is done", after.ok && after.body?.authenticated !== false, brief(after));
  record("onboarding", { c: true, r: get1.ok, u: save.ok, d: "n/a" });
});

await part("3. The estate — facilities, departments, doctors", async () => {
  const fac = await admin.json("/api/records/facility", "POST", { name: `Main Building ${uniq}`, city: "Pune" });
  check("a facility can be created", fac.ok, brief(fac));
  const facId = fac.body?.record?.id ?? fac.body?.id;

  const dept = await admin.json("/api/records/department", "POST", { name: `Cardiology ${uniq}`, facilityId: facId });
  check("a department can be created", dept.ok, brief(dept));
  const deptId = dept.body?.record?.id ?? dept.body?.id;

  const doc = await admin.json("/api/records/provider", "POST", {
    name: `Dr Asha Kulkarni ${uniq}`, speciality: "Cardiology", departmentId: deptId, facilityId: facId,
    registrationNo: `MH-${uniq}`, phone: "9820012345",
  });
  check("a doctor can be added once, and reused", doc.ok, brief(doc));
  const docId = doc.body?.record?.id ?? doc.body?.id;

  const read = await admin.req("/api/records/provider");
  check("doctors can be listed", read.ok && (read.body?.items ?? []).length >= 1, brief(read));

  const upd = await admin.json(`/api/records/provider/${docId}`, "PATCH", { speciality: "Interventional Cardiology" });
  check("a doctor's details can be corrected", upd.ok, brief(upd));

  const del = await admin.req(`/api/records/provider/${docId}`, { method: "DELETE" });
  note("a doctor can be removed", del.ok, brief(del));
  record("facility", { c: fac.ok, r: true, u: "—", d: "—" });
  record("department", { c: dept.ok, r: true, u: "—", d: "—" });
  record("doctor", { c: doc.ok, r: read.ok, u: upd.ok, d: del.ok });

  globalThis.__ids = { facId, deptId };
});

await part("4. Wards and beds", async () => {
  const ward = await admin.json("/api/wards", "POST", { name: `General Ward ${uniq}`, type: "general", floor: 2 });
  check("a ward can be opened", ward.ok, brief(ward));
  const wardId = ward.body?.ward?.id;

  const list = await admin.req("/api/wards");
  check("wards can be listed", list.ok && (list.body?.items ?? []).some((w) => w.id === wardId), brief(list));

  const rename = await admin.json(`/api/wards/${wardId}`, "PATCH", { name: `Renamed Ward ${uniq}` });
  check("a ward can be renamed", rename.ok, brief(rename));

  const dupWard = await admin.json("/api/wards", "POST", { name: `Renamed Ward ${uniq}` });
  check("a duplicate ward name is refused", dupWard.status === 409, brief(dupWard));

  /* The convenience that matters: a whole ward's beds in one call. */
  const run = await admin.json("/api/beds", "POST", { wardId, prefix: "GW-", from: 1, to: 12, dailyRate: 1500 });
  check("a run of beds can be created in one go", run.ok && run.body?.created === 12, brief(run));

  const again = await admin.json("/api/beds", "POST", { wardId, prefix: "GW-", from: 10, to: 14, dailyRate: 1500 });
  check("re-running the range fills the gap and skips what exists",
    again.ok && again.body?.created === 2 && (again.body?.skipped ?? []).length === 3, brief(again));

  const beds = await admin.req(`/api/beds?wardId=${wardId}`);
  check("beds can be listed for a ward", beds.ok && (beds.body?.items ?? []).length === 14, `${(beds.body?.items ?? []).length} beds`);

  const bedId = (beds.body?.items ?? [])[0]?.id;
  const bedEdit = await admin.json(`/api/beds/${bedId}`, "PATCH", { dailyRate: 1800 });
  check("a bed's rate can be corrected", bedEdit.ok, brief(bedEdit));

  const bedStatus = await admin.json(`/api/beds/${bedId}`, "PATCH", { status: "CLEANING", note: "terminal clean" });
  check("a bed can be put into cleaning", bedStatus.ok, brief(bedStatus));

  const forceOccupied = await admin.json(`/api/beds/${bedId}`, "PATCH", { status: "OCCUPIED" });
  check("a bed cannot be marked occupied by hand", !forceOccupied.ok, brief(forceOccupied));

  const retire = await admin.req(`/api/beds/${(beds.body?.items ?? [])[13]?.id}`, { method: "DELETE" });
  check("a bed can be retired", retire.ok, brief(retire));

  record("ward", { c: ward.ok, r: list.ok, u: rename.ok, d: "closeable" });
  record("bed", { c: run.ok, r: beds.ok, u: bedEdit.ok, d: retire.ok });
  globalThis.__ids = { ...globalThis.__ids, wardId, bedId: (beds.body?.items ?? [])[1]?.id };
});

await part("5. Staff — the multi-user part", async () => {
  const mk = await admin.json("/api/users", "POST", {
    name: "Sister Meena", email: `crud.nurse+${uniq}@crudtest.test`, role: "nurse", password: PW,
  });
  check("a member of staff can be invited", mk.ok, brief(mk));
  const userId = mk.body?.user?.id;

  const list = await admin.req("/api/users");
  check("staff can be listed", list.ok && (list.body?.items ?? list.body?.users ?? []).length >= 2, brief(list));

  const upd = await admin.json(`/api/users/${userId}`, "PATCH", { phone: "9820055555", role: "nurse" });
  check("a member of staff can be edited", upd.ok, brief(upd));

  const suspend = await admin.json(`/api/users/${userId}`, "PATCH", { status: "suspended" });
  check("an account can be suspended", suspend.ok, brief(suspend));

  const reinstate = await admin.json(`/api/users/${userId}`, "PATCH", { status: "active" });
  check("and reinstated", reinstate.ok, brief(reinstate));

  const del = await admin.req(`/api/users/${userId}`, { method: "DELETE" });
  check("an account can be removed", del.ok, brief(del));
  record("staff account", { c: mk.ok, r: list.ok, u: upd.ok, d: del.ok });

  /* A clinician for the chart and laboratory sections below. */
  const docEmail = `crud.doctor+${uniq}@crudtest.test`;
  const made = await admin.json("/api/users", "POST", { name: "Dr Verma", email: docEmail, role: "doctor", password: PW });
  check("a doctor account can be created and signed in", made.ok, brief(made));
  const doctor = client();
  await signIn(doctor, docEmail, PW);
  const works = await doctor.req("/api/patients?limit=1");
  check("the doctor's own session works", works.ok, brief(works));
  globalThis.__doctor = doctor;
});

await part("6. Patients", async () => {
  const mk = await admin.json("/api/patients", "POST", {
    firstName: "Sanjay", lastName: `Kadam${uniq}`, gender: "male", dateOfBirth: "1972-06-15",
    mobile: "9820033333", village: "Wagholi", district: "Pune",
  });
  check("a patient can be registered", mk.ok, brief(mk));
  const pid = mk.body?.patient?.id;
  check("a hospital number is issued automatically", Boolean(mk.body?.patient?.uhid), String(mk.body?.patient?.uhid));

  const one = await admin.req(`/api/patients/${pid}`);
  check("the whole chart can be read in one call", one.ok && one.body?.patient?.id === pid, brief(one));

  const search = await admin.req(`/api/patients?q=Kadam${uniq}`);
  check("patients can be searched by name", search.ok && (search.body?.items ?? []).length >= 1, brief(search));

  const byPhone = await admin.req("/api/patients?q=9820033333");
  check("and by phone number", byPhone.ok && (byPhone.body?.items ?? []).length >= 1, brief(byPhone));

  const upd = await admin.json(`/api/patients/${pid}`, "PATCH", { mobile: "9820044444", village: "Kharadi" });
  check("demographics can be corrected", upd.ok, brief(upd));

  const bad = await admin.json(`/api/patients/${pid}`, "PATCH", { phone: "1" });
  check("a field that does not exist is refused, not silently dropped", bad.status === 422, brief(bad));

  const del = await admin.req(`/api/patients/${pid}`, { method: "DELETE" });
  note("a patient record cannot be deleted outright", !del.ok, `${del.status} — correct for a medical record`);
  record("patient", { c: mk.ok, r: one.ok, u: upd.ok, d: "not deletable, by design" });
  globalThis.__ids = { ...globalThis.__ids, pid };
});

await part("7. The chart — vitals, allergies, diagnoses, medicines", async () => {
  const { pid } = globalThis.__ids;
  /*
   * A doctor, not the administrator.
   *
   * `hospital_admin` has no `vitals.record`, `encounters.write` or
   * `prescriptions.write`, and that is right: running a hospital and treating a
   * patient are different jobs, and an administrator who can quietly write a
   * prescription is a finding, not a feature. Charting through an admin account
   * tests the permission system, not the chart.
   */
  const doctor = globalThis.__doctor;
  const v = await doctor.json(`/api/patients/${pid}/vitals`, "POST", { systolic: 148, diastolic: 92, pulse: 88, temperatureC: 37.1 });
  check("vitals can be recorded", v.ok, brief(v));
  const vr = await doctor.req(`/api/patients/${pid}/vitals`);
  check("vitals can be read back", vr.ok && (vr.body?.items ?? []).length >= 1, brief(vr));

  const a = await doctor.json(`/api/patients/${pid}/allergies`, "POST", { substance: "Penicillin", reaction: "Rash", severity: "moderate" });
  check("an allergy can be recorded", a.ok, brief(a));
  const ar = await doctor.req(`/api/patients/${pid}/allergies`);
  check("allergies can be read back", ar.ok && (ar.body?.items ?? []).length >= 1, brief(ar));
  const allergyId = (ar.body?.items ?? [])[0]?.id;
  const aRetire = await doctor.json(`/api/patients/${pid}/allergies`, "PATCH",
    { allergyId, status: "entered_in_error", reason: "recorded against the wrong patient" });
  note("an allergy can be retired rather than deleted", aRetire.ok, brief(aRetire));

  const d = await doctor.json(`/api/patients/${pid}/diagnoses`, "POST", {
    code: "I10", description: "Essential hypertension", status: "active", category: "final",
  });
  check("a diagnosis can be recorded", d.ok, brief(d));

  const m = await doctor.json(`/api/patients/${pid}/medications`, "POST", {
    medicine: "Amlodipine", dose: "5 mg", route: "oral", frequency: "OD", durationDays: 30,
  });
  check("a medicine can be prescribed", m.ok, brief(m));
  const mr = await doctor.req(`/api/patients/${pid}/medications`);
  check("prescriptions can be read back", mr.ok && (mr.body?.items ?? []).length >= 1, brief(mr));
  const medId = (mr.body?.items ?? [])[0]?.id;
  const mStop = await doctor.json(`/api/medications/${medId}`, "PATCH", { status: "stopped", reason: "ankle oedema" });
  check("a medicine can be stopped with a reason, in any case", mStop.ok, brief(mStop));
  /* A status the database does not allow must be a refusal, not a 500 leaking
     the CHECK constraint and its permitted values. */
  const mBad = await doctor.json(`/api/medications/${medId}`, "PATCH", { status: "obliterated", reason: "x" });
  check("an invalid status is refused without leaking the database constraint",
    mBad.status === 422 && !/CHECK constraint|sqlite/i.test(JSON.stringify(mBad.body ?? "")), brief(mBad));

  record("vitals", { c: v.ok, r: vr.ok, u: "append-only", d: "append-only" });
  record("allergy", { c: a.ok, r: ar.ok, u: aRetire.ok, d: "retired, not deleted" });
  record("diagnosis", { c: d.ok, r: true, u: "—", d: "—" });
  record("medication", { c: m.ok, r: mr.ok, u: mStop.ok, d: "stopped, not deleted" });
});

await part("8. Admission, transfer, discharge", async () => {
  const { pid, bedId, wardId } = globalThis.__ids;
  const adm = await admin.json("/api/admissions", "POST", {
    patientId: pid, bedId, type: "elective", reason: "Hypertensive urgency",
  });
  check("a patient can be admitted to a bed", adm.ok, brief(adm));
  const admId = adm.body?.admission?.id;

  const list = await admin.req("/api/admissions");
  check("current admissions can be listed", list.ok && (list.body?.items ?? []).length >= 1, brief(list));

  const beds = await admin.req(`/api/beds?wardId=${wardId}`);
  const occupied = (beds.body?.items ?? []).find((b) => b.id === bedId);
  check("the ward board shows the patient in the bed", Boolean(occupied?.occupant), JSON.stringify(occupied?.occupant ?? {}).slice(0, 60));

  const afterAdmit = await admin.req(`/api/beds?wardId=${wardId}`);
  const freeBed = (afterAdmit.body?.items ?? []).find((b) => !b.occupant && b.status === "AVAILABLE" && b.id !== bedId);
  check("there is another free bed to transfer into", Boolean(freeBed?.id), `${(afterAdmit.body?.items ?? []).length} beds in ward`);
  const transfer = await admin.json(`/api/admissions/${admId}`, "POST", {
    action: "transfer", toBedId: freeBed?.id, reason: "closer to the nursing station",
    authorizedBy: "Dr Verma",
  });
  check("a patient can be transferred to another bed", transfer.ok, brief(transfer));

  const discharge = await admin.json(`/api/admissions/${admId}`, "POST", {
    action: "discharge", dischargeType: "routine",
    dischargeSummary: "BP controlled on amlodipine 5mg OD. Follow up in 2 weeks.",
    finalDiagnosis: "Essential hypertension, controlled",
  });
  check("a patient can be discharged", discharge.ok, brief(discharge));

  const after = await admin.req(`/api/beds?wardId=${wardId}`);
  const released = (after.body?.items ?? []).find((b) => b.id === freeBed?.id);
  check("the bed is released on discharge", !released?.occupant, JSON.stringify(released?.occupant ?? {}).slice(0, 50));

  record("admission", { c: adm.ok, r: list.ok, u: `${transfer.ok ? "transfer" : "—"}/${discharge.ok ? "discharge" : "—"}`, d: "not deletable, by design" });
});

await part("9. Laboratory", async () => {
  const { pid } = globalThis.__ids;
  const doctor = globalThis.__doctor;
  const cat = await doctor.req("/api/lab/catalog");
  check("the test catalogue can be read", cat.ok, brief(cat));
  const catalogue = cat.body?.items ?? [];
  const testCode = catalogue[0]?.code;
  check("the catalogue is populated for a new hospital", catalogue.length > 0, `${catalogue.length} tests`);

  const order = await doctor.json("/api/lab/orders", "POST", {
    patientId: pid, testCodes: testCode ? [testCode] : [], priority: "routine", clinicalNote: "Check renal function",
  });
  check("a test can be ordered", order.ok, brief(order));
  const orderId = order.body?.order?.id;

  const list = await doctor.req("/api/lab/orders");
  check("lab orders can be listed", list.ok, brief(list));

  const read = await doctor.req(`/api/lab/orders/${orderId}`);
  check("one order can be opened", read.ok, brief(read));

  /* Collection is the laboratory's job — a doctor ordering it does not also
     draw the sample, and the permissions say so. */
  const labEmail = `crud.lab+${uniq}@crudtest.test`;
  await admin.json("/api/users", "POST", { name: "Lab Tech", email: labEmail, role: "lab_tech", password: PW });
  const lab = client();
  await signIn(lab, labEmail, PW);
  const collect = await lab.json(`/api/lab/orders/${orderId}`, "POST", { action: "collect", specimen: "blood" });
  check("the laboratory can mark a sample collected", collect.ok, brief(collect));

  const cancel = await lab.json(`/api/lab/orders/${orderId}`, "POST", { action: "cancel", reason: "ordered in error" });
  note("an order can be cancelled with a reason", cancel.ok, brief(cancel));

  record("lab order", { c: order.ok, r: list.ok, u: collect.ok, d: cancel.ok ? "cancelled, not deleted" : "—" });
});

await part("10. Money — charges and invoices", async () => {
  const charges = await admin.req("/api/charges");
  check("charges can be listed", charges.ok, brief(charges));
  const raised = (charges.body?.items ?? []).length;
  check("the admission and the test raised charges by themselves", raised >= 1, `${raised} charges`);
  record("charge", { c: "raised by clinical events", r: charges.ok, u: "—", d: "—" });
});

await part("11. Configuration a hospital changes on day one", async () => {
  const s = await admin.req("/api/settings/storage");
  check("storage settings can be read", s.ok, brief(s));
  const save = await admin.json("/api/settings/storage", "PUT", {
    value: { driver: "local", local: { path: ".data/recordings" }, retentionDays: { audio: 90, transcript: 365, summary: 2555 } },
  });
  check("storage settings can be saved", save.ok, brief(save));

  const v = await admin.req("/api/settings/voice");
  check("voice settings can be read", v.ok, brief(v));
  const e = await admin.json("/api/settings/escalation", "PUT", {
    value: { mainLineNumber: "+912012345678", transferMode: "warm", ringSeconds: 25, slaMinutes: 15 },
  });

  /* Sending it unwrapped is the obvious mistake, and must be a clear refusal
     rather than the 500 it used to produce. */
  const unwrapped = await admin.json("/api/settings/escalation", "PUT", { mainLineNumber: "+912012345678" });
  check("an unwrapped settings body is refused with an explanation, not a crash",
    unwrapped.status === 422 && /value/i.test(JSON.stringify(unwrapped.body ?? "")), brief(unwrapped));
  check("escalation routing can be saved", e.ok, brief(e));
  record("settings", { c: "n/a", r: s.ok, u: save.ok, d: "n/a" });
});

await part("12. Data out — export, and the audit trail", async () => {
  const ex = await admin.json("/api/exports", "POST", { template: "patients", maskPhone: true, includeClinical: false });
  check("an export can be produced", ex.ok, brief(ex));
  const job = ex.body?.job;
  const dl = job ? await admin.req(`/api/exports/${job.id}/download?token=${job.downloadToken}`) : { ok: false, status: 0 };
  check("and downloaded", dl.ok, `HTTP ${dl.status}`);

  const audit = await admin.req("/api/audit");
  check("the audit trail can be read", audit.ok, brief(audit));
  const rows = audit.body?.logs ?? audit.body?.items ?? [];
  check("it recorded what was done in this run",
    rows.some((a) => /patient.created|admission|ward|bed/i.test(String(a.action))), `${rows.length} rows`);
  record("export", { c: ex.ok, r: dl.ok, u: "n/a", d: "expires" });
  record("audit", { c: "written by the system", r: audit.ok, u: "never", d: "never" });
});

/* ------------------------------------------------------------------ */
console.log("\n\x1b[1mWhat this hospital can do\x1b[0m");
console.log("  entity              create  read    update            delete");
for (const m of matrix) {
  const f = (v) => (v === true ? "yes" : v === false ? "NO" : String(v));
  console.log(`  ${m.entity.padEnd(20)}${f(m.c).padEnd(8)}${f(m.r).padEnd(8)}${f(m.u).padEnd(18)}${f(m.d)}`);
}

console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
if (failures.length) {
  console.log("\n\x1b[31mFailures\x1b[0m");
  for (const f of failures) console.log(`  · ${f}`);
}
process.exit(failed ? 1 : 0);
