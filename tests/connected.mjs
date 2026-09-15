/**
 * The connected chain.
 *
 * Proves that laboratory, ward, patient and billing are one system rather than
 * four screens: that a result is interpreted for the patient it belongs to, that
 * it reaches the ward board, that releasing it raises a charge, that a bed
 * accrues its own days, that two people cannot silently overwrite each other,
 * and that every one of those changes reaches other users' screens live.
 *
 * Run with the app already serving on BASE (default http://localhost:3100).
 */

const BASE = process.env.BASE ?? "http://localhost:3100";

let passed = 0, failed = 0;
const failures = [];
let group = "";

const section = (n) => { group = n; console.log(`\n\x1b[1m${n}\x1b[0m`); };
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { failed++; failures.push(`${group} → ${name}${detail ? ` (${detail})` : ""}`); console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ` — ${detail}` : ""}`); }
}

function client() {
  let cookie = "";
  return {
    get cookie() { return cookie; },
    async req(path, init = {}) {
      const res = await fetch(BASE + path, {
        ...init,
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(init.headers ?? {}) },
        redirect: "manual",
      });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        if (pair.startsWith("hos_session=")) cookie = pair;
      }
      const text = await res.text();
      let body; try { body = JSON.parse(text); } catch { body = text; }
      return { status: res.status, ok: res.ok, body };
    },
    json(path, method, payload) {
      return this.req(path, { method, body: payload === undefined ? undefined : JSON.stringify(payload) });
    },
  };
}

async function login(email, password = "demo1234") {
  const c = client();
  const r = await c.json("/api/auth/login", "POST", { email, password });
  if (!r.ok) throw new Error(`login ${email}: ${JSON.stringify(r.body).slice(0, 140)}`);
  return c;
}

/** Collect events from the live stream into an array until stopped. */
async function openStream(c) {
  const events = [];
  const res = await fetch(BASE + "/api/stream", { headers: { Cookie: c.cookie, Accept: "text/event-stream" } });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const f of frames) {
          if (!f.includes("event: change")) continue;
          const line = f.split("\n").find((l) => l.startsWith("data: "));
          if (line) { try { events.push(JSON.parse(line.slice(6))); } catch { /* ignore */ } }
        }
      }
    } catch { /* closed */ }
  })();
  return { events, close: () => { reader.cancel().catch(() => {}); return pump; } };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================================================================== */

const admin  = await login("sunita.kale@democare.in");
const doctor = await login("a.deshmukh@democare.in");
const nurse  = await login("r.tambe@democare.in");
const tech   = await login("s.dhumal@democare.in");
const biller = await login("f.khan@democare.in");
const reception = await login("g.more@democare.in");

const roster = (await admin.req("/api/patients?limit=100")).body.items ?? [];
const male   = roster.find((p) => p.gender === "male"   && (p.age ?? 0) >= 18);
const female = roster.find((p) => p.gender === "female" && (p.age ?? 0) >= 18);

/** Drive one order from ordering to results. */
async function orderAndEnter(patient, entries, tests = ["CBC", "RFT"]) {
  const o = await doctor.json("/api/lab/orders", "POST", { patientId: patient.id, testCodes: tests });
  if (!o.ok) throw new Error(`order failed: ${JSON.stringify(o.body).slice(0, 160)}`);
  const oid = o.body.order.id;
  await tech.json(`/api/lab/orders/${oid}`, "POST", { action: "collect", specimen: "Blood" });
  await tech.json(`/api/lab/orders/${oid}`, "POST", { action: "process" });
  const r = await tech.json(`/api/lab/orders/${oid}`, "POST", { action: "results", entries });
  return { oid, res: r };
}

/* ------------------------------------------------------------------ */
section("A result is read against the right patient");
{
  const m = await orderAndEnter(male, [{ analyteCode: "HB", value: "12.5" }]);
  const f = await orderAndEnter(female, [{ analyteCode: "HB", value: "12.5" }]);
  const hbM = m.res.body.order?.results?.find((r) => r.analyteCode === "HB");
  const hbF = f.res.body.order?.results?.find((r) => r.analyteCode === "HB");

  check("the same haemoglobin gets a man's reference range", hbM?.refLow === 13 && hbM?.refHigh === 17, `${hbM?.refLow}–${hbM?.refHigh}`);
  check("and a woman's", hbF?.refLow === 12 && hbF?.refHigh === 15, `${hbF?.refLow}–${hbF?.refHigh}`);
  check("so 12.5 g/dL is low in him", hbM?.flag === "LOW", hbM?.flag);
  check("and normal in her", hbF?.flag === "NORMAL", hbF?.flag);
}

/* ------------------------------------------------------------------ */
section("A typing mistake is not a critical result");
{
  const o = await doctor.json("/api/lab/orders", "POST", { patientId: male.id, testCodes: ["CBC"] });
  const oid = o.body.order.id;
  await tech.json(`/api/lab/orders/${oid}`, "POST", { action: "collect", specimen: "Blood" });
  await tech.json(`/api/lab/orders/${oid}`, "POST", { action: "process" });
  const typo = await tech.json(`/api/lab/orders/${oid}`, "POST", { action: "results", entries: [{ analyteCode: "HB", value: "145" }] });

  check("a haemoglobin of 145 is refused", typo.status === 422, `status ${typo.status}`);
  check("and the likely intended value is offered", /14\.5/.test(String(typo.body.error)), String(typo.body.error).slice(0, 90));

  const ok = await tech.json(`/api/lab/orders/${oid}`, "POST", { action: "results", entries: [{ analyteCode: "HB", value: "14.5" }] });
  check("the corrected value is accepted", ok.ok, JSON.stringify(ok.body).slice(0, 100));
}

/* ------------------------------------------------------------------ */
section("A result inconsistent with the patient's own history is queried");
{
  await orderAndEnter(female, [{ analyteCode: "K", value: "4.1" }]);
  const second = await orderAndEnter(female, [{ analyteCode: "K", value: "6.9" }]);
  const k = second.res.body.order?.results?.find((r) => r.analyteCode === "K");

  check("the delta check fires on a large swing", Boolean(k?.deltaNote), k?.deltaNote ?? "(none)");
  check("and it asks about sample identity", /sample belongs to this patient/i.test(k?.deltaNote ?? ""));
  check("the value is still flagged critical", k?.flag === "CRITICAL_HIGH", k?.flag);
  check("a critical notification is raised", ((await tech.req("/api/lab/critical")).body.items ?? []).length > 0);
}

/* ------------------------------------------------------------------ */
section("Derived values are computed, not typed");
{
  const f = await orderAndEnter(female, [{ analyteCode: "CREAT", value: "1.0" }]);
  const m = await orderAndEnter(male,   [{ analyteCode: "CREAT", value: "1.0" }]);
  const eF = f.res.body.order?.results?.find((r) => r.analyteCode === "EGFR");
  const eM = m.res.body.order?.results?.find((r) => r.analyteCode === "EGFR");

  check("eGFR appears without anyone entering it", Boolean(eF?.value), eF?.value);
  check("it is marked as calculated", eF?.computed === true && eF?.enteredBy === "calculated");
  check("the same creatinine gives different eGFR by sex", eF?.value !== eM?.value, `${eF?.value} vs ${eM?.value}`);
  check("both are physiologically plausible", Number(eF?.value) > 20 && Number(eM?.value) > 20 && Number(eM?.value) < 200);
}

/* ------------------------------------------------------------------ */
section("A formula that does not apply reports why, instead of a number");
{
  const r = await orderAndEnter(male, [
    { analyteCode: "CHOL", value: "240" }, { analyteCode: "HDL", value: "50" }, { analyteCode: "TG", value: "450" },
  ], ["LIPID"]);
  const ldl = r.res.body.order?.results?.find((x) => x.analyteCode === "LDLCALC");
  check("calculated LDL is withheld above a triglyceride of 400", ldl && !ldl.value, `value=${ldl?.value}`);
  check("and the reason is recorded", /not valid|direct LDL/i.test(ldl?.refText ?? ""), ldl?.refText ?? "");
}

/* ------------------------------------------------------------------ */
section("The laboratory reaches the ward board");
{
  const beds = (await nurse.req("/api/beds")).body.items ?? [];
  const free = beds.find((b) => b.status === "AVAILABLE");
  const idle = (await nurse.req("/api/patients?limit=80")).body.items.find((p) => !p.currentAdmission);

  const adm = await nurse.json("/api/admissions", "POST", { patientId: idle.id, bedId: free.id });
  check("the patient is admitted to a bed", adm.ok, JSON.stringify(adm.body).slice(0, 120));
  const admissionId = adm.body.admission?.id;

  await orderAndEnter(idle, [{ analyteCode: "K", value: "6.9" }]);

  const board = (await nurse.req("/api/beds")).body.items ?? [];
  const bed = board.find((b) => b.id === free.id);
  check("the bed shows its occupant's outstanding labs", (bed?.occupant?.pendingLabs ?? 0) > 0, `pending=${bed?.occupant?.pendingLabs}`);
  check("and their unacknowledged critical results", (bed?.occupant?.unacknowledgedCriticals ?? 0) > 0, `critical=${bed?.occupant?.unacknowledgedCriticals}`);

  globalThis.__admissionId = admissionId;
  globalThis.__admittedPatient = idle;
  globalThis.__bedId = free.id;
}

/* ------------------------------------------------------------------ */
section("Billing follows the clinical record, not a second keyboard");
{
  const patient = globalThis.__admittedPatient;
  const o = await orderAndEnter(patient, [{ analyteCode: "HB", value: "13.0" }], ["CBC"]);
  await tech.json(`/api/lab/orders/${o.oid}`, "POST", { action: "verify" });

  const before = (await biller.req(`/api/charges?patientId=${patient.id}`)).body;
  const beforeLab = (before.items ?? []).filter((c) => c.sourceType === "lab_order").length;

  const rel = await tech.json(`/api/lab/orders/${o.oid}`, "POST", { action: "release" });
  check("the report is released", rel.ok, JSON.stringify(rel.body).slice(0, 100));

  const after = (await biller.req(`/api/charges?patientId=${patient.id}`)).body;
  const labCharges = (after.items ?? []).filter((c) => c.sourceType === "lab_order");
  check("releasing it raises a charge", labCharges.length === beforeLab + 1, `${beforeLab} → ${labCharges.length}`);

  const mine = labCharges.find((c) => c.sourceId === o.oid);
  check("the charge names the order that caused it", Boolean(mine), mine?.sourceId);
  check("and carries the catalogue price", mine?.amount === 350, `₹${mine?.amount}`);

  /* Re-releasing an amended report must not bill twice. */
  await tech.json(`/api/lab/orders/${o.oid}`, "POST", { action: "results", entries: [{ analyteCode: "HB", value: "13.4" }], amendReason: "Re-run on a fresh sample" });
  await tech.json(`/api/lab/orders/${o.oid}`, "POST", { action: "verify" });
  await tech.json(`/api/lab/orders/${o.oid}`, "POST", { action: "release" });
  const twice = ((await biller.req(`/api/charges?patientId=${patient.id}`)).body.items ?? [])
    .filter((c) => c.sourceType === "lab_order" && c.sourceId === o.oid);
  check("an amended report does not bill the patient twice", twice.length === 1, `${twice.length} charges`);
}

/* ------------------------------------------------------------------ */
section("A bed accrues its own days");
{
  const admissionId = globalThis.__admissionId;
  const patient = globalThis.__admittedPatient;

  const disc = await nurse.json(`/api/admissions/${admissionId}`, "POST", {
    action: "discharge", dischargeType: "routine",
    finalDiagnosis: "Hypokalaemia corrected", dischargeSummary: "Stable, potassium corrected, discharged home.",
  });
  check("the patient is discharged", disc.ok, JSON.stringify(disc.body).slice(0, 140));

  const charges = (await biller.req(`/api/charges?patientId=${patient.id}`)).body.items ?? [];
  const bedDays = charges.filter((c) => c.sourceType === "bed_day");
  check("bed-days are charged for the stay", bedDays.length >= 1, `${bedDays.length} days`);
  check("each names the bed and the date", /Bed charge —/.test(bedDays[0]?.description ?? ""), bedDays[0]?.description);

  /* Discharging is idempotent for billing: recomputing must not duplicate. */
  const again = (await biller.req(`/api/charges?patientId=${patient.id}`)).body.items ?? [];
  const uniqueSources = new Set(again.filter((c) => c.sourceType === "bed_day").map((c) => c.sourceId));
  check("no bed-day is charged twice", uniqueSources.size === again.filter((c) => c.sourceType === "bed_day").length);

  const bed = ((await nurse.req("/api/beds")).body.items ?? []).find((b) => b.id === globalThis.__bedId);
  check("discharge releases the bed without deleting it", bed && bed.status !== "OCCUPIED" && !bed.occupant, `status=${bed?.status}`);
}

/* ------------------------------------------------------------------ */
section("Search finds the patient asked for, and nobody else");
{
  const target = (await admin.req("/api/patients?limit=1")).body.items[0];

  /* A name or id containing digits must not be treated as a phone number. */
  const byName = await admin.req(`/api/patients?q=${encodeURIComponent(target.fullName.split(" ")[0])}`);
  const named = (byName.body.items ?? []);
  check("searching a name returns only name matches",
    named.every((p) => `${p.fullName} ${p.uhid} ${p.externalId ?? ""}`.toLowerCase()
      .includes(target.fullName.split(" ")[0].toLowerCase())),
    named.filter((p) => !p.fullName.toLowerCase().includes(target.fullName.split(" ")[0].toLowerCase()))
      .map((p) => p.fullName).slice(0, 3).join(", "));

  /* A real phone number must still find its owner. */
  if (target.mobile) {
    const digits = String(target.mobile).replace(/\D/g, "").slice(-10);
    const byPhone = await admin.req(`/api/patients?q=${digits}`);
    check("searching a phone number still finds the patient",
      (byPhone.body.items ?? []).some((p) => p.id === target.id), `q=${digits}`);
  }
}

/* ------------------------------------------------------------------ */
section("Two people cannot silently overwrite each other");
{
  const p = (await admin.req("/api/patients?limit=1")).body.items[0];
  const v = p.version;

  /*
   * Fresh values every run. Writing the value a field already holds is not a
   * conflict — correctly — so a fixed number would silently stop testing the
   * thing this section exists to test once a previous run had set it.
   */
  const tag = String(Date.now()).slice(-6);
  const mineMobile = `98765${tag.slice(0, 5)}`;
  const theirsMobile = `99999${tag.slice(0, 5)}`;
  const theirsEmail = `ward${tag}@example.in`;

  const first = await doctor.json(`/api/patients/${p.id}`, "PATCH", { mobile: mineMobile, expectedVersion: v });
  check("the first edit saves", first.ok, JSON.stringify(first.body).slice(0, 100));

  /* Both actors must genuinely hold patients.edit — a nurse does not, and a 403
     would prove nothing about concurrency. Reception and the doctor both do. */
  const clash = await reception.json(`/api/patients/${p.id}`, "PATCH", { mobile: theirsMobile, expectedVersion: v });
  check("a second edit of the same field is refused", clash.status === 409, `status ${clash.status}`);
  check("and the refusal says what changed and who changed it",
    Array.isArray(clash.body.conflicts) && clash.body.conflicts[0]?.field === "mobile" && Boolean(clash.body.conflicts[0]?.changedBy),
    JSON.stringify(clash.body.conflicts ?? []).slice(0, 120));

  const disjoint = await reception.json(`/api/patients/${p.id}`, "PATCH", { email: theirsEmail, expectedVersion: v });
  check("an edit to a different field is NOT blocked", disjoint.ok, `status ${disjoint.status}`);

  const after = (await admin.req(`/api/patients/${p.id}`)).body.patient;
  check("neither person's change was lost", after.mobile.includes(mineMobile) && after.email === theirsEmail,
    `${after.mobile} / ${after.email}`);
}

/* ------------------------------------------------------------------ */
section("Everything above reaches other people's screens live");
{
  const watcher = await openStream(admin);
  const outsider = await login("nitin.wagh@sahyadricity.in");
  const otherHospital = await openStream(outsider);
  await wait(700);

  const p = (await admin.req("/api/patients?limit=1")).body.items[0];
  await nurse.json(`/api/patients/${p.id}/vitals`, "POST", { pulse: 92, systolic: 128, diastolic: 82 });
  const o = await orderAndEnter(p, [{ analyteCode: "HB", value: "13.2" }], ["CBC"]);
  await tech.json(`/api/lab/orders/${o.oid}`, "POST", { action: "verify" });
  await tech.json(`/api/lab/orders/${o.oid}`, "POST", { action: "release" });
  await wait(1600);

  const topics = new Set(watcher.events.map((e) => e.topic));
  check("vitals recorded elsewhere arrive", topics.has("vitals"), [...topics].join(","));
  check("laboratory activity arrives", topics.has("lab"), [...topics].join(","));
  check("billing activity arrives", topics.has("billing"), [...topics].join(","));
  check("events name the patient they concern", watcher.events.some((e) => e.patientId === p.id));
  check("no event carries patient data",
    watcher.events.every((e) => !JSON.stringify(e).match(/name|mobile|value|diagnos/i)),
    JSON.stringify(watcher.events[0] ?? {}).slice(0, 120));
  check("another hospital receives nothing", otherHospital.events.length === 0, `${otherHospital.events.length} leaked`);

  await watcher.close();
  await otherHospital.close();
}

/* ------------------------------------------------------------------ */
console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
if (failures.length) {
  console.log("\n\x1b[31mFailures\x1b[0m");
  for (const f of failures) console.log(`  · ${f}`);
}
process.exit(failed ? 1 : 0);
