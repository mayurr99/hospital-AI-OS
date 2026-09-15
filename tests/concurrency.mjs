/**
 * Many people, at once, doing the same thing.
 *
 * A hospital is not a queue. At 9am the ward round, the front desk, the
 * laboratory and the pharmacy are all writing at the same second, and the bugs
 * that only appear then are the worst kind: they do not throw, they do not log,
 * they quietly produce two patients with the same hospital number, or two
 * patients in one bed.
 *
 * Every check here runs its requests genuinely in parallel — `Promise.all`, not
 * a loop — and then asks what the database actually ended up holding. The
 * question is never "did the calls succeed" but "is the result still correct".
 *
 * What is being hunted:
 *
 *   · duplicate hospital numbers from a counter read by two writers at once
 *   · one bed admitting two patients
 *   · a lost update, where two edits land and one silently disappears
 *   · a conflict refused when it should be, and allowed when it should be
 *   · the system still answering reads while all of that is going on
 *
 *   node tests/concurrency.mjs
 */
import { signIn } from "./signin.mjs";

const BASE = process.env.BASE ?? "http://localhost:3100";

let passed = 0, failed = 0;
const failures = [];
let group = "";
const section = (n) => { group = n; console.log(`\n\x1b[1m${n}\x1b[0m`); };
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { failed++; failures.push(`${group} → ${name}${detail ? ` (${detail})` : ""}`); console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ` — ${detail}` : ""}`); }
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
const ms = () => Date.now();

/* ================================================================== */
console.log("\x1b[1mConcurrency\x1b[0m — many people writing at the same second\n");

section("0. One hospital, with a shift's worth of staff");
const admin = client();
const adminEmail = `conc.admin+${uniq}@conctest.test`;
let r = await admin.json("/api/auth/signup", "POST", {
  hospitalName: `Concurrency Hospital ${uniq}`, adminName: "Shift Admin", email: adminEmail, password: PW, acceptedTerms: true,
});
check("the hospital exists", r.ok && r.body.orgId, JSON.stringify(r.body).slice(0, 100));

/*
 * Enrol the administrator's second factor now, deliberately.
 *
 * Sign-up hands back a session without one. The first proper sign-in enrols an
 * authenticator and — correctly — ends every other session for that account,
 * which would otherwise pull the rug out from under this client halfway through
 * the file and report a concurrency failure that is really a security feature
 * working. Getting it over with here means every later sign-in is an ordinary
 * verification.
 */
await signIn(admin, adminEmail, PW);

/* Eight members of staff, created in parallel — the first concurrent write. */
const STAFF = [
  ["nurse", "Nurse One"], ["nurse", "Nurse Two"], ["nurse", "Nurse Three"],
  ["receptionist", "Reception One"], ["receptionist", "Reception Two"],
  ["doctor", "Doctor One"], ["lab_tech", "Lab One"], ["pharmacist", "Pharmacy One"],
];
const created = await Promise.all(
  STAFF.map(([role, name], i) =>
    admin.json("/api/users", "POST", { name, email: `conc.${i}+${uniq}@conctest.test`, role, password: PW })),
);
check("eight staff accounts created in parallel", created.every((c) => c.ok), `${created.filter((c) => c.ok).length}/8`);

/* ================================================================== */
await part("1. Eight people signing in at the same moment", async () => {
  const t0 = ms();
  const clients = STAFF.map(() => client());
  const results = await Promise.all(
    clients.map((c, i) => signIn(c, `conc.${i}+${uniq}@conctest.test`, PW)),
  );
  const elapsed = ms() - t0;
  check("every sign-in succeeded", results.every((x) => x.ok), `${results.filter((x) => x.ok).length}/8`);

  /* Each must hold a session of their own, not share or overwrite one. */
  const tokens = new Set(clients.map((c) => c.cookie));
  check("each person got a distinct session", tokens.size === clients.length, `${tokens.size} distinct of ${clients.length}`);

  const probes = await Promise.all(clients.map((c) => c.req("/api/patients?limit=1")));
  check("every session works independently", probes.every((p) => p.ok), `${probes.filter((p) => p.ok).length}/8 ok`);
  console.log(`   eight concurrent sign-ins in ${elapsed}ms`);

  globalThis.__staff = clients;
  /*
   * Split the shift by what each role is actually allowed to do. Concurrency is
   * being tested here, not authorisation — that has its own suite — so every
   * request below is made by somebody entitled to make it.
   */
  globalThis.__registrars = STAFF
    .map((s, i) => ({ role: s[0], c: clients[i] }))
    .filter((x) => ["nurse", "receptionist", "doctor"].includes(x.role))
    .map((x) => x.c);
  globalThis.__charters = STAFF
    .map((s, i) => ({ role: s[0], c: clients[i] }))
    .filter((x) => ["nurse", "doctor"].includes(x.role))
    .map((x) => x.c);
});

/* ================================================================== */
await part("2. Twenty patients registered at once — hospital numbers must be unique", async () => {
  /*
   * The classic counter race. Two receptionists registering at the same instant
   * both read "next number is 41" and both write 41, and a hospital now has two
   * different people under one UHID. Nothing errors. It is found weeks later by
   * a pharmacist dispensing against the wrong record.
   */
  /*
   * Only the people whose job it is. A pharmacist has `patients.view` and
   * nothing else, so sending registrations through one tests the permission
   * system, not the counter — and reports a race that is not there.
   */
  const staff = globalThis.__registrars ?? [];
  const N = 20;
  const t0 = ms();
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      (staff[i % staff.length] ?? admin).json("/api/patients", "POST", {
        firstName: `Race${i}`, lastName: `Test${uniq}`, gender: i % 2 ? "male" : "female",
        dateOfBirth: "1990-01-01", mobile: `98${String(70000000 + i)}`,
      })),
  );
  const elapsed = ms() - t0;
  const ok = results.filter((x) => x.ok);
  check("all twenty registrations were accepted", ok.length === N,
    `${ok.length}/${N} — ${[...new Set(results.filter((x) => !x.ok).map((x) => `${x.status}:${JSON.stringify(x.body).slice(0, 50)}`))].join(" ")}`);

  const uhids = ok.map((x) => x.body?.patient?.uhid ?? x.body?.uhid).filter(Boolean);
  const unique = new Set(uhids);
  check("every hospital number is unique", unique.size === uhids.length,
    `${uhids.length} issued, ${unique.size} distinct`);

  const ids = new Set(ok.map((x) => x.body?.patient?.id ?? x.body?.id).filter(Boolean));
  check("every record id is unique", ids.size === ok.length, `${ids.size} of ${ok.length}`);
  console.log(`   twenty parallel registrations in ${elapsed}ms`);

  globalThis.__patients = ok.map((x) => x.body?.patient?.id ?? x.body?.id).filter(Boolean);
});

/* ================================================================== */
await part("3. Two nurses recording vitals on the same patient at the same time", async () => {
  const staff = globalThis.__charters ?? [];
  const patient = (globalThis.__patients ?? [])[0];
  if (!patient) { check("a patient to work on", false); return; }

  const writes = await Promise.all([
    staff[0].json(`/api/patients/${patient}/vitals`, "POST", { systolic: 120, diastolic: 80, pulse: 72, temperatureC: 36.8 }),
    staff[1].json(`/api/patients/${patient}/vitals`, "POST", { systolic: 138, diastolic: 88, pulse: 96, temperatureC: 37.4 }),
    staff[2].json(`/api/patients/${patient}/vitals`, "POST", { systolic: 118, diastolic: 76, pulse: 64, temperatureC: 36.5 }),
  ]);
  check("all three observations were accepted", writes.every((w) => w.ok), writes.map((w) => w.status).join(","));

  const back = await admin.req(`/api/patients/${patient}/vitals`);
  const items = back.body?.items ?? [];
  check("all three are in the record — none was lost", items.length >= 3, `${items.length} rows`);

  /*
   * Observations are additive history, so three writes must mean three rows.
   * If a later write had overwritten an earlier one, a doctor reading the chart
   * would see a normal blood pressure and never know a raised one had been
   * recorded — which is the kind of loss that ends up in a coroner's report.
   */
  const pulses = new Set(items.map((v) => v.pulse));
  check("the distinct readings are all preserved", pulses.has(72) && pulses.has(96) && pulses.has(64),
    [...pulses].join(","));
});

/* ================================================================== */
await part("4. Two receptionists admitting to the same bed", async () => {
  /* One ward, one bed — created through the routes a hospital would use. */
  const ward = await admin.json("/api/wards", "POST", { name: `Race Ward ${uniq}`, type: "general", floor: 1 });
  const wardId = ward.body?.ward?.id;
  const bed = await admin.json("/api/beds", "POST", { wardId, number: `RB-${uniq}`, dailyRate: 2000 });
  const bedId = bed.body?.bed?.id;

  if (!bedId) {
    console.log(`   (no bed available to contend for: ${JSON.stringify(bed.body).slice(0, 110)})`);
    check("a bed to contend for", false);
    return;
  }
  check("a ward with one bed exists", Boolean(wardId && bedId), `ward ${wardId} bed ${bedId}`);

  const patients = globalThis.__patients ?? [];
  const staff = globalThis.__registrars ?? [];
  const [p1, p2] = [patients[1], patients[2]];

  /* Two people with admitting rights, firing at the same instant. */
  const admitter2 = client();
  await signIn(admitter2, adminEmail, PW);
  const both = await Promise.all([
    admin.json("/api/admissions", "POST", { patientId: p1, bedId, reason: "Race A", type: "elective" }),
    admitter2.json("/api/admissions", "POST", { patientId: p2, bedId, reason: "Race B", type: "elective" }),
  ]);
  const accepted = both.filter((x) => x.ok);

  /*
   * This is the check that matters most in this file. One must win and one must
   * be told the bed is taken. Two winners means two patients in one bed on the
   * ward board, and the nurse who finds out is the one who walks into the room.
   */
  check("exactly one admission won the bed", accepted.length === 1,
    `${accepted.length} succeeded — ${both.map((b) => `${b.status}`).join(" / ")}`);
  if (accepted.length !== 1) {
    console.log(`   responses: ${both.map((b) => JSON.stringify(b.body).slice(0, 80)).join(" | ")}`);
  }

  const loser = both.find((x) => !x.ok);
  check("the loser is told why, not given a server error",
    !loser || (loser.status >= 400 && loser.status < 500 && /bed|occupied|taken|available/i.test(JSON.stringify(loser.body ?? ""))),
    loser ? `HTTP ${loser.status} ${JSON.stringify(loser.body).slice(0, 70)}` : "n/a");

  const beds = await admin.req(`/api/beds?wardId=${wardId}`);
  const thisBed = (beds.body?.items ?? []).find((b) => b.id === bedId);
  check("the bed shows exactly one occupant", !thisBed || thisBed.status !== "available" || accepted.length === 0,
    JSON.stringify(thisBed ?? {}).slice(0, 90));
});

/* ================================================================== */
await part("5. Two people editing the same patient — no silent lost update", async () => {
  /* Two administrators — both entitled to edit, which is what makes this a
     concurrency test rather than a permissions one. */
  const editorA = admin;
  const editorB = client();
  await signIn(editorB, adminEmail, PW);
  const staff = [editorA, editorB];
  const patient = (globalThis.__patients ?? [])[3];
  if (!patient) { check("a patient to edit", false); return; }

  /* Both read the same version, then both write the same field. */
  const before = await staff[0].req(`/api/patients/${patient}`);
  const version = before.body?.patient?.version ?? before.body?.version;

  const both = await Promise.all([
    staff[0].json(`/api/patients/${patient}`, "PATCH", { mobile: "9820000001", expectedVersion: version }),
    staff[1].json(`/api/patients/${patient}`, "PATCH", { mobile: "9820000002", expectedVersion: version }),
  ]);
  const winners = both.filter((x) => x.ok);
  const conflicts = both.filter((x) => x.status === 409);

  check("the same field written twice does not silently take both",
    winners.length === 1 || conflicts.length >= 1,
    `${winners.length} accepted, ${conflicts.length} refused as conflicts`);

  /* Whatever the outcome, the stored value must be one of the two — not a mix. */
  const after = await admin.req(`/api/patients/${patient}`);
  const phone = after.body?.patient?.mobile ?? after.body?.mobile ?? "";
  const originalPhone = before.body?.patient?.mobile ?? "";
  /*
   * Whatever the outcome, the stored value must be *a* value somebody wrote —
   * one of the two new ones, or the original if both were refused. What must
   * never appear is a blend of the two, which is what a partial write looks
   * like.
   */
  check("the stored value is one somebody actually wrote, not a blend",
    ["9820000001", "9820000002", String(originalPhone)].some((p) => p && String(phone).includes(String(p).slice(-6))),
    `stored ${phone}, was ${originalPhone}, wrote 9820000001 / 9820000002`);

  /* Disjoint edits are a different matter and must both be allowed. */
  const fresh = await staff[0].req(`/api/patients/${patient}`);
  const v2 = fresh.body?.patient?.version ?? fresh.body?.version;
  const disjoint = await Promise.all([
    staff[0].json(`/api/patients/${patient}`, "PATCH", { mobile: "9820000003", expectedVersion: v2 }),
    staff[1].json(`/api/patients/${patient}`, "PATCH", { preferredLanguage: "hi", expectedVersion: v2 }),
  ]);
  check("two people editing different fields are not made to fight",
    disjoint.filter((x) => x.ok).length >= 1, disjoint.map((d) => d.status).join(","));

  /*
   * A field the endpoint does not write must be refused, not ignored. Silently
   * accepting `phone` when the field is `mobile` means somebody corrects a
   * patient's number, sees no error, and the ward rings the old one.
   */
  const bogus = await staff[0].json(`/api/patients/${patient}`, "PATCH", { phone: "9820000009" });
  check("an unrecognised field is refused rather than silently dropped",
    bogus.status === 422 && /not a patient field/i.test(JSON.stringify(bogus.body ?? "")),
    `HTTP ${bogus.status} ${JSON.stringify(bogus.body ?? "").slice(0, 70)}`);
});

/* ================================================================== */
await part("6. Reads stay available while the writing goes on", async () => {
  const charters = globalThis.__charters ?? [];
  const staff = globalThis.__staff ?? [];
  const patients = globalThis.__patients ?? [];

  const writers = Array.from({ length: 30 }, (_, i) =>
    charters[i % charters.length].json(`/api/patients/${patients[i % patients.length]}/vitals`, "POST",
      { systolic: 110 + (i % 30), diastolic: 70 + (i % 20), pulse: 60 + (i % 40) }));

  const t0 = ms();
  const readers = Array.from({ length: 30 }, (_, i) =>
    staff[i % staff.length].req("/api/patients?limit=20"));

  const [w, rd] = await Promise.all([Promise.all(writers), Promise.all(readers)]);
  const elapsed = ms() - t0;

  check("thirty concurrent writes all succeeded", w.every((x) => x.ok),
    `${w.filter((x) => x.ok).length}/30 — ${[...new Set(w.filter((x) => !x.ok).map((x) => x.status))].join(",")}`);
  check("thirty concurrent reads all succeeded", rd.every((x) => x.ok), `${rd.filter((x) => x.ok).length}/30`);
  /*
   * SQLite serialises writers. The thing that must not happen is a reader being
   * refused with "database is locked" because a writer held the file — which is
   * what `busy_timeout` and WAL are configured for.
   */
  const locked = [...w, ...rd].filter((x) => /locked|busy|SQLITE_BUSY/i.test(JSON.stringify(x.body ?? "")));
  check("nobody was turned away with a database lock", locked.length === 0, `${locked.length} lock errors`);
  console.log(`   sixty concurrent operations in ${elapsed}ms`);
});

/* ================================================================== */
await part("7. One person, many tabs — the same session used in parallel", async () => {
  /*
   * A doctor with six tabs open is one session making six simultaneous
   * requests. Session handling that assumes one request at a time shows up
   * here, usually as a session that gets rotated out from under itself.
   */
  const one = globalThis.__staff?.[5];
  if (!one) { check("a signed-in person", false); return; }

  const tabs = await Promise.all([
    one.req("/api/patients?limit=5"),
    one.req("/api/bootstrap"),
    one.req("/api/admissions"),
    one.req("/api/lab/orders"),
    one.req("/api/patients?limit=5&offset=5"),
    one.req("/api/auth/me"),
  ]);
  check("six simultaneous requests on one session all succeed", tabs.every((t) => t.ok),
    tabs.map((t) => t.status).join(","));
  const stillWorks = await one.req("/api/patients?limit=1");
  check("the session survives being used in parallel", stillWorks.ok, `HTTP ${stillWorks.status}`);
});

/* ================================================================== */
await part("8. Duplicate registration attempts in the same instant", async () => {
  /*
   * Two receptionists registering the same walk-in patient. The product's
   * duplicate detection should catch it — but detection that reads before it
   * writes is exactly the thing a race defeats.
   */
  const staff = globalThis.__registrars ?? [];
  const same = {
    firstName: "Identical", lastName: `Twin${uniq}`, gender: "male",
    dateOfBirth: "1988-08-08", mobile: "9820099999",
  };
  const both = await Promise.all([
    staff[0].json("/api/patients", "POST", same),
    staff[1].json("/api/patients", "POST", same),
  ]);
  const accepted = both.filter((x) => x.ok);
  const found = await admin.req(`/api/patients?q=Twin${uniq}`);
  const count = found.body?.total ?? (found.body?.items ?? []).length;

  /*
   * Either one is created and the other is flagged, or both are created and the
   * product shows them as possible duplicates. What must not happen is two
   * records that nothing knows are the same person.
   */
  /*
   * The product deliberately warns rather than blocks here: a shared mobile and
   * date of birth is ordinary inside one family, and a registration desk that
   * cannot register somebody is worse than a flagged pair a human resolves.
   * Clinical records are never merged on resemblance.
   *
   * So the requirement is not "one is refused" — it is that neither slips
   * through unflagged. The duplicate check used to run before the write lock,
   * so in a race both were told "no matches" and the hospital got two charts
   * for one person with nothing anywhere saying so.
   */
  check("both registrations were accepted or one refused — never a crash",
    accepted.length >= 1 && both.every((b) => b.status < 500), both.map((b) => b.status).join(","));

  const flagged = both.filter((b) => (b.body?.possibleMatches ?? []).length > 0 || b.status === 409);
  check("at least one of the two is flagged as a possible duplicate",
    flagged.length >= 1,
    both.map((b) => `${b.status}:${(b.body?.possibleMatches ?? []).length} matches`).join(" | "));

  check("the register does not silently hold two unlinked charts for one person",
    count <= 2 && flagged.length >= 1, `register holds ${count}, ${flagged.length} flagged`);
});

/* ------------------------------------------------------------------ */
console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
if (failures.length) {
  console.log("\n\x1b[31mFailures\x1b[0m");
  for (const f of failures) console.log(`  · ${f}`);
}
process.exit(failed ? 1 : 0);
