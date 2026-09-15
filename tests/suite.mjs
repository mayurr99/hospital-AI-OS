/**
 * End-to-end test suite for Hospital AI OS.
 *
 * Covers the SaaS lifecycle (signup → trial → onboarding → ready dashboard),
 * CRUD on every record type through the real API, tenant isolation,
 * permission enforcement, storage configuration, voice provider configuration,
 * the critical-call forwarding path, recordings and governed exports.
 *
 * Run with the app already serving on BASE (default http://localhost:3100).
 */

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

/**
 * The workspace a signed-in user actually receives.
 *
 * The client loads its shell from /api/bootstrap and its lists from
 * /api/collections, so the tests assemble the same two calls rather than
 * asserting against a single fat endpoint that no longer exists.
 */
async function workspace(c) {
  const shell = (await c.req("/api/bootstrap")).body;
  if (!shell?.authenticated || !shell.org) return shell;
  const lists = (await c.req("/api/collections")).body;
  return { ...shell, ...lists, authenticated: true };
}

/* ------------------------------------------------------------------ */
/* a tiny cookie-jar http client, one per signed-in user               */
/* ------------------------------------------------------------------ */

function client() {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    async req(path, init = {}) {
      const res = await fetch(BASE + path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(init.headers ?? {}),
        },
        redirect: "manual",
      });
      const setCookie = res.headers.getSetCookie?.() ?? [];
      for (const c of setCookie) {
        const [pair] = c.split(";");
        if (pair.startsWith("hos_session=")) cookie = pair;
      }
      const ct = res.headers.get("content-type") ?? "";
      const bodyOut = ct.includes("application/json") ? await res.json().catch(() => ({})) : await res.text();
      return { status: res.status, ok: res.ok, body: bodyOut, headers: res.headers };
    },
    json(path, method, payload) {
      return this.req(path, { method, body: payload === undefined ? undefined : JSON.stringify(payload) });
    },
  };
}

const uniq = Date.now().toString(36);

/* ------------------------------------------------------------------ */

async function run() {
  /* ================= 1. public surface ================= */
  section("1. Public pages");
  for (const [path, needle] of [
    ["/", "Hospital AI OS"],
    ["/signup", "Create your hospital workspace"],
    ["/login", "Sign in"],
  ]) {
    const r = await client().req(path);
    check(`GET ${path} renders`, r.status === 200 && String(r.body).includes(needle), `status ${r.status}`);
  }

  /* ================= 2. signup + trial ================= */
  section("2. Signup, tenant creation and 7-day trial");

  const hospA = client();
  const emailA = `admin+${uniq}@sunrisehospital.test`;
  let r = await hospA.json("/api/auth/signup", "POST", {
    hospitalName: `Sunrise Multispeciality ${uniq}`,
    adminName: "Dr. Asha Rao",
    email: emailA,
    password: "supersecret123",
    city: "Pune",
  });
  check("signup succeeds", r.ok && r.body.orgId, JSON.stringify(r.body).slice(0, 120));
  const orgA = r.body.orgId;
  check("signup routes to onboarding", r.body.next === "/onboarding");
  check("session cookie issued", hospA.cookie.startsWith("hos_session="));

  r = await hospA.req("/api/auth/me");
  check("me returns the new admin", r.body.user?.email === emailA);
  check("role is hospital_admin", r.body.user?.role === "hospital_admin");
  check("subscription is trialing", r.body.subscription?.status === "trialing");
  check("trial is 7 days", r.body.subscription?.trialDaysLeft === 7, `got ${r.body.subscription?.trialDaysLeft}`);
  check("onboarding is incomplete", r.body.onboardingComplete === false);

  r = await hospA.json("/api/auth/signup", "POST", {
    hospitalName: "Duplicate", adminName: "X", email: emailA, password: "supersecret123",
  });
  check("duplicate email rejected", r.status === 409, `status ${r.status}`);

  r = await hospA.json("/api/auth/signup", "POST", {
    hospitalName: "Weak", adminName: "X", email: `weak+${uniq}@t.test`, password: "123",
  });
  check("weak password rejected", r.status === 400);

  /* ================= 3. onboarding ================= */
  section("3. Hospital setup wizard");

  r = await hospA.req("/api/onboarding");
  check("onboarding state readable", r.ok && r.body.completed === false);

  r = await hospA.json("/api/onboarding", "PATCH", { step: 2, answers: { city: "Pune", beds: 60 } });
  check("progress saves between steps", r.ok && r.body.answers.city === "Pune");

  r = await hospA.req("/api/onboarding");
  check("progress survives a reload", r.body.step === 2 && r.body.answers.beds === 60);

  const answers = {
    goal: "whole",
    hospitalName: `Sunrise Multispeciality ${uniq}`,
    city: "Pune",
    state: "Maharashtra",
    beds: 60,
    branches: [{ name: "Sunrise — Kothrud", address: "Paud Road", phone: "+912012345678", beds: 60 }],
    departments: ["Cardiology", "General Medicine", "Orthopaedics"],
    doctors: [
      { name: "Dr. Asha Rao", department: "Cardiology", speciality: "Cardiology", minutes: 20, fee: 900 },
      { name: "Dr. Vivek Sane", department: "General Medicine", speciality: "General Medicine", minutes: 15, fee: 600 },
    ],
    languages: ["mr", "hi", "en"],
    features: ["ai_receptionist", "followup_agent", "call_recording", "doctor_crm", "care_queue", "escalation", "appointments", "ipd", "billing", "messaging", "analytics", "data_io"],
    storageDriver: "local",
    voiceProvider: "simulator",
    mainLineNumber: "+912040009999",
    loadSampleData: true,
  };

  r = await hospA.json("/api/onboarding", "POST", { answers: { ...answers, departments: [] } });
  check("provisioning rejects zero departments", r.status === 400);

  r = await hospA.json("/api/onboarding", "POST", { answers });
  check("provisioning succeeds", r.ok, JSON.stringify(r.body).slice(0, 140));
  check("facilities created", r.body.facilities?.length === 1);
  check("departments created", r.body.departments?.length === 3);
  check("doctors created", r.body.providers?.length === 2);

  r = await hospA.req("/api/auth/me");
  check("onboarding now complete", r.body.onboardingComplete === true);

  const bootA = await workspace(hospA);
  r = { ok: true, body: bootA };
  check("bootstrap scoped to the new tenant", bootA.org?.id === orgA);
  check("sample patients loaded", bootA.patient?.length === 12, `got ${bootA.patient?.length}`);
  check("sample appointments loaded", bootA.appointment?.length === 8);
  check("starter protocol created as draft", bootA.protocol?.[0]?.status === "draft");
  check("agents created as drafts", bootA.agent?.length === 2 && bootA.agent.every((a) => a.status === "draft"));
  check("beds provisioned for IPD", (bootA.bed?.length ?? 0) > 0);
  check("chosen modules unlocked", bootA.subscription?.features?.length === answers.features.length);
  check("main line stored on escalation config", bootA.settings?.escalation?.mainLineNumber === "+912040009999");

  /* ================= 4. CRUD on every record type ================= */
  section("4. CRUD across all record types");

  const facilityId = bootA.facility[0].id;
  const deptId = bootA.department[0].id;
  const providerId = bootA.provider[0].id;
  const patientId = bootA.patient[0].id;

  const crudCases = [
    ["appointment", { facilityId, patientId, providerId, departmentId: deptId, start: new Date(Date.now() + 86400000).toISOString(), durationMinutes: 20, status: "booked", source: "reception_desk", reason: "CRUD test", createdAt: new Date().toISOString() }, { status: "confirmed" }],
    ["task", { patientId, queue: "review", title: "CRUD task", detail: "d", assignedTo: null, priority: "normal", createdAt: new Date().toISOString(), dueAt: new Date().toISOString(), status: "open" }, { status: "done" }],
    ["campaign", { name: "CRUD campaign", agentType: "care", protocolId: bootA.protocol[0].id, departmentId: deptId, cohortDescription: "test", totalPatients: 5, called: 0, connected: 0, completed: 0, escalated: 0, languages: ["mr"], window: "10-18", retryPolicy: "2", status: "draft", startDate: new Date().toISOString() }, { status: "running" }],
    ["drug", { name: "CRUD Drug", form: "Tablet", strength: "10 mg", batch: "B1", expiry: new Date(Date.now() + 8.64e7 * 200).toISOString(), stock: 100, reorderLevel: 20, unitPrice: 5, supplier: "S", scheduleH: false }, { stock: 500 }],
    ["invoice", { patientId, number: "CRUD/1", issuedAt: new Date().toISOString(), lines: [{ description: "OPD", qty: 1, rate: 500, category: "consultation" }], discount: 0, taxRate: 0, paid: 0, status: "issued", payer: "self" }, { paid: 500, status: "paid" }],
    ["emergencyCase", { facilityId, patientName: "CRUD ER", patientId: null, age: 30, complaint: "Test", triage: 3, arrivalMode: "walk_in", arrivedAt: new Date().toISOString(), vitals: { bp: "120/80", pulse: 80, spo2: 98, temp: 37 }, assignedTo: "Dr X", status: "waiting" }, { status: "in_treatment" }],
    ["otSlot", { facilityId, theatre: "OT-1", start: new Date().toISOString(), durationMinutes: 60, procedure: "CRUD op", patientId, surgeonId: providerId, anaesthetist: "Dr A", status: "scheduled", checklistComplete: false, priority: "elective" }, { checklistComplete: true }],
    ["integration", { name: "CRUD HIS", kind: "his", vendor: "Test", status: "sandbox", lastSync: null, recordsSynced: 0, direction: "inbound", endpoint: "https://x" }, { status: "live" }],
    ["protocol", { name: "CRUD protocol", departmentId: deptId, version: "V9", status: "draft", approvedBy: null, approvedAt: null, questions: [], redFlags: [], escalationTarget: "x", slaMinutes: 15 }, { status: "approved" }],
  ];

  for (const [kind, payload, patch] of crudCases) {
    const c = await hospA.json(`/api/records/${kind}`, "POST", payload);
    const created = c.body.record;
    if (!c.ok || !created?.id) {
      check(`${kind}: create`, false, JSON.stringify(c.body).slice(0, 100));
      continue;
    }
    check(`${kind}: create`, true);

    const read = await hospA.req(`/api/records/${kind}/${created.id}`);
    check(`${kind}: read back`, read.ok && read.body.record?.id === created.id);

    const upd = await hospA.json(`/api/records/${kind}/${created.id}`, "PATCH", patch);
    const key = Object.keys(patch)[0];
    check(`${kind}: update`, upd.ok && String(upd.body.record?.[key]) === String(patch[key]), `${key}=${upd.body.record?.[key]}`);

    const list = await hospA.req(`/api/records/${kind}`);
    check(`${kind}: appears in list`, list.body.items?.some((x) => x.id === created.id));

    const del = await hospA.json(`/api/records/${kind}/${created.id}`, "DELETE");
    check(`${kind}: delete`, del.ok);

    const gone = await hospA.req(`/api/records/${kind}/${created.id}`);
    check(`${kind}: gone after delete`, gone.status === 404);
  }

  r = await hospA.req("/api/records/not_a_kind");
  check("unknown record type rejected", r.status === 404);

  /* ================= 5. persistence ================= */
  section("5. Persistence across sessions");
  const created = await hospA.json("/api/patients", "POST", {
    firstName: "Persist", lastName: "Check", dateOfBirth: "1984-04-04", gender: "male",
    mobile: "9000000002", bloodGroup: "O+", facilityId, departmentId: deptId, providerId,
  });
  const persistId = created.body.patient.id;

  const hospA2 = client();
  /* A real hospital, so this account owes a second factor — signIn plays the
     part of the person and their authenticator. See tests/signin.mjs. */
  r = await signIn(hospA2, emailA, "supersecret123");
  check("login with the created credentials", r.ok && r.body.user?.email === emailA);
  check("login routes straight to the dashboard", r.body.next === "/dashboard");
  r = await hospA2.req(`/api/patients/${persistId}`);
  check("record persists into a brand new session", r.ok && r.body.patient?.fullName === "Persist Check", JSON.stringify(r.body.patient?.fullName));

  r = await hospA2.json("/api/auth/login", "POST", { email: emailA, password: "wrongpassword" });
  check("wrong password rejected", r.status === 401);

  /* ================= 6. tenant isolation ================= */
  section("6. Multi-tenant isolation");

  const hospB = client();
  const emailB = `admin+${uniq}@harmonycare.test`;
  r = await hospB.json("/api/auth/signup", "POST", {
    hospitalName: `Harmony Care ${uniq}`, adminName: "Mr. Bose", email: emailB, password: "supersecret123", city: "Nashik",
  });
  const orgB = r.body.orgId;
  check("second hospital signs up", r.ok && orgB && orgB !== orgA);

  await hospB.json("/api/onboarding", "POST", {
    answers: { ...answers, hospitalName: `Harmony Care ${uniq}`, departments: ["General Medicine"], doctors: [], loadSampleData: true },
  });

  r = { ok: true, body: await workspace(hospB) };
  const bootB = r.body;
  check("hospital B sees only its own org", bootB.org?.id === orgB);
  check("hospital B cannot see hospital A patients", !bootB.patient?.some((p) => p.id === persistId));

  r = await hospB.req(`/api/patients/${persistId}`);
  check("direct fetch of another tenant's record is 404", r.status === 404, `status ${r.status}`);

  r = await hospB.json(`/api/patients/${persistId}`, "PATCH", { firstName: "hijacked" });
  check("cross-tenant update refused", r.status === 404);

  r = await hospB.req(`/api/patients/${persistId}`, { method: "DELETE" });
  // There is no patient DELETE endpoint at all now — clinical records are
  // corrected, never destroyed — so a 405 is as good a refusal as a 404.
  check("cross-tenant delete refused", r.status === 404 || r.status === 405, `status ${r.status}`);

  r = await hospA2.req(`/api/patients/${persistId}`);
  check("record untouched after the cross-tenant attempts", r.ok && r.body.patient?.fullName === "Persist Check", JSON.stringify(r.body.patient?.fullName));

  r = await hospB.req("/api/platform/tenants");
  check("platform console refused to a hospital admin", r.status === 403);

  const anon = client();
  r = await anon.req("/api/bootstrap");
  check("anonymous bootstrap is unauthenticated", r.body.authenticated === false);
  r = await anon.req("/api/patients");
  check("anonymous record read is 401", r.status === 401);

  /* ================= 7. users and permissions ================= */
  section("7. User management and permission enforcement");

  r = await hospA2.json("/api/users", "POST", {
    name: "Nurse Test", email: `nurse+${uniq}@sunrisehospital.test`, role: "nurse", password: "supersecret123", mfaEnabled: false,
  });
  check("invite a nurse", r.ok && r.body.user?.role === "nurse", JSON.stringify(r.body).slice(0, 100));
  const nurseId = r.body.user?.id;

  r = await hospA2.json("/api/users", "POST", {
    name: "Bad", email: `bad+${uniq}@x.test`, role: "super_admin", password: "supersecret123",
  });
  check("cannot grant a platform role from a hospital", r.status === 403);

  const nurse = client();
  r = await signIn(nurse, `nurse+${uniq}@sunrisehospital.test`, "supersecret123");
  check("nurse can sign in", r.ok);

  r = await nurse.req("/api/users");
  check("nurse cannot list users (no users.manage)", r.status === 403);

  r = await nurse.json("/api/records/agent", "POST", { name: "hack", type: "care" });
  check("nurse cannot create an agent (no agents.configure)", r.status === 403);

  r = await nurse.json("/api/records/task", "POST", {
    patientId, queue: "callback", title: "nurse task", detail: "d", assignedTo: null, priority: "normal",
    createdAt: new Date().toISOString(), dueAt: new Date().toISOString(), status: "open",
  });
  check("nurse CAN create a care task (has queue.care)", r.ok);

  r = await hospA2.json(`/api/users/${nurseId}`, "PATCH", { status: "suspended" });
  check("admin suspends the nurse", r.ok && r.body.user?.status === "suspended");

  r = { ok: true, body: await workspace(nurse) };
  check("suspension revokes the live session immediately", r.body.authenticated === false);

  r = await signIn(nurse, `nurse+${uniq}@sunrisehospital.test`, "supersecret123");
  check("suspended user cannot sign in", r.status === 403);

  r = await hospA2.json(`/api/users/${nurseId}`, "DELETE");
  check("admin removes the user", r.ok);

  /* ================= 8. storage configuration ================= */
  section("8. Storage configuration");

  r = await hospA2.req("/api/settings/storage");
  check("storage settings readable", r.ok && r.body.value?.driver === "local");

  r = await hospA2.json("/api/settings/storage", "PUT", {
    value: { ...r.body.value, retentionDays: { audio: 90, transcript: 365, summary: 2555 } },
  });
  check("storage settings save", r.ok && r.body.value?.retentionDays?.audio === 90);

  r = await hospA2.json("/api/settings/test", "POST", { target: "storage" });
  check("local storage write/read/delete verified", r.body.ok === true, r.body.detail);

  r = await hospA2.req("/api/settings/storage");
  check("verification timestamp recorded", Boolean(r.body.value?.verifiedAt));

  const s3cfg = { ...r.body.value, driver: "s3", s3: { ...r.body.value.s3, bucket: "", accessKeyId: "", secretAccessKey: "" } };
  await hospA2.json("/api/settings/storage", "PUT", { value: s3cfg });
  r = await hospA2.json("/api/settings/test", "POST", { target: "storage" });
  check("S3 without a bucket fails honestly", r.body.ok === false && /bucket/i.test(r.body.detail), r.body.detail);
  await hospA2.json("/api/settings/storage", "PUT", { value: { ...s3cfg, driver: "local" } });

  /* ================= 9. voice providers ================= */
  section("9. Voice provider configuration");

  r = await hospA2.req("/api/settings/voice");
  check("voice settings readable", r.ok && r.body.value?.telephonyProvider === "simulator");

  r = await hospA2.json("/api/settings/voice", "PUT", {
    value: { ...r.body.value, retell: { ...r.body.value.retell, apiKey: "key_test_not_real" }, elevenlabs: { ...r.body.value.elevenlabs, apiKey: "sk_test_not_real" } },
  });
  check("voice keys save", r.ok);
  check("api keys are returned masked, never in clear", r.body.value?.retell?.apiKey === "••••••••", r.body.value?.retell?.apiKey);

  r = await hospA2.json("/api/settings/voice", "PUT", { value: r.body.value });
  const after = await hospA2.req("/api/settings/voice");
  check("re-saving a masked value keeps the stored secret", after.body.value?.retell?.apiKey === "••••••••");

  r = await hospA2.json("/api/settings/test", "POST", { target: "retell" });
  check("retell test with a bad key fails honestly", r.body.ok === false, r.body.detail);
  r = await hospA2.json("/api/settings/test", "POST", { target: "elevenlabs" });
  check("elevenlabs test with a bad key fails honestly", r.body.ok === false, r.body.detail);

  await hospA2.json("/api/settings/voice", "PUT", {
    value: { ...after.body.value, telephonyProvider: "simulator", ttsProvider: "simulator", retell: { ...after.body.value.retell, apiKey: "" }, elevenlabs: { ...after.body.value.elevenlabs, apiKey: "" } },
  });
  r = await hospA2.json("/api/settings/test", "POST", { target: "retell" });
  check("with no keys the simulator reports ready", r.body.ok === true && r.body.simulated === true);

  r = await hospA2.req("/api/voice/voices");
  check("voice list falls back to simulator voices", r.ok && r.body.voices?.length > 0 && r.body.simulated === true);

  r = await hospA2.req("/api/voice/preview", { method: "POST", body: JSON.stringify({ text: "नमस्कार" }) });
  check("TTS preview returns audio", r.status === 200 && String(r.body).length > 1000);
  check("preview is marked simulated", r.headers.get("x-simulated") === "1");

  /* ================= 10. calls, recording, forwarding ================= */
  section("10. Calls, recordings and critical forwarding");

  const bootNow = await workspace(hospA2);
  const callPatient = bootNow.patient.find((p) => p.consent?.clinicalCalls && p.consent?.recording);
  check("a consenting patient exists for calling", Boolean(callPatient));

  r = await hospA2.json("/api/voice/call", "POST", { patientId: callPatient.id, agentType: "care" });
  check("outbound call starts", r.ok && r.body.providerCallId, JSON.stringify(r.body).slice(0, 100));
  const providerCallId = r.body.providerCallId;
  check("call runs on the simulator when no keys are set", r.body.simulated === true);

  const noConsent =
    bootNow.patient.find((p) => !p.consent?.clinicalCalls && p.id !== callPatient.id) ??
    (await (async () => {
      const target = bootNow.patient.find((p) => p.id !== callPatient.id);
      await hospA2.json(`/api/patients/${target.id}`, "PATCH", {
        consent: { ...target.consent, clinicalCalls: false },
      });
      return target;
    })());
  r = await hospA2.json("/api/voice/call", "POST", { patientId: noConsent.id, agentType: "care" });
  check("consent engine blocks calling a withdrawn patient", r.status === 403, `status ${r.status}`);

  r = await hospB.json("/api/voice/call", "POST", { patientId: callPatient.id, agentType: "care" });
  check("cannot call another tenant's patient", r.status === 404);

  r = await hospA2.json("/api/voice/forward", "POST", {
    patientId: callPatient.id,
    providerCallId,
    trigger: "New chest pain post cardiac discharge (R1)",
  });
  check("critical forwarding succeeds", r.ok, JSON.stringify(r.body).slice(0, 140));
  check("forwarded to the configured main line", r.body.connectedTo === "+912040009999", r.body.connectedTo);
  check("escalation opened", Boolean(r.body.escalationId));
  check("high-priority task raised alongside", Boolean(r.body.taskId));
  check("SLA carried from the escalation config", r.body.slaMinutes === 15);
  check("each step of the handover is reported", Array.isArray(r.body.steps) && r.body.steps.length >= 3);

  const afterForward = await workspace(hospA2);
  check("escalation persisted and open", afterForward.escalation?.some((e) => e.id === r.body.escalationId && e.status === "open"));
  check("patient risk raised to red", afterForward.patient.find((p) => p.id === callPatient.id)?.risk === "red");
  check("critical task queued", afterForward.task?.some((t) => t.queue === "critical"));

  const escId = r.body.escalationId;
  let up = await hospA2.json(`/api/records/escalation/${escId}`, "PATCH", { status: "acknowledged", acknowledgedAt: new Date().toISOString() });
  check("escalation can be acknowledged", up.ok && up.body.record.status === "acknowledged");
  up = await hospA2.json(`/api/records/escalation/${escId}`, "PATCH", { status: "resolved", resolutionNote: "Reviewed by on-call, ECG advised." });
  check("escalation can be resolved with a note", up.ok && up.body.record.status === "resolved");

  r = await hospA2.json("/api/voice/call", "POST", {
    patientId: callPatient.id,
    agentType: "care",
    finalize: {
      durationSeconds: 62, risk: "red",
      transcript: [{ speaker: "agent", text: "Hello", atSecond: 0 }, { speaker: "patient", text: "Chest pain", atSecond: 8, flag: "red" }],
      structured: { "General health": "Worse", "Chest pain": "Yes" },
      summary: "Red flag call, forwarded.", outcome: "Red flag — forwarded to main line",
      status: "transferred", providerCallId,
    },
  });
  check("call finalises and is stored", r.ok && r.body.call?.id, JSON.stringify(r.body).slice(0, 120));
  check("recording written for a consenting patient", Boolean(r.body.recordingId));
  const callId = r.body.call.id;

  r = await hospA2.req("/api/recordings");
  check("recordings list readable", r.ok && r.body.recordings?.length > 0);
  const rec = r.body.recordings.find((x) => x.callId === callId);
  check("the new recording is listed", Boolean(rec));
  check("recording carries a retention date", Boolean(rec?.retentionUntil));
  check("recording stored via the configured driver", rec?.storageKind === "local");

  r = await hospA2.req(`/api/recordings/${rec.id}/audio`);
  check("recording audio streams back", r.status === 200 && String(r.body).length > 1000);

  r = await hospB.req(`/api/recordings/${rec.id}/audio`);
  check("another tenant cannot fetch the audio", r.status === 404);

  const usage = (await hospA2.req("/api/auth/me")).body;
  check("voice minutes metered on the subscription", (usage.subscription?.voiceMinutesUsed ?? 0) > 0, `${usage.subscription?.voiceMinutesUsed}`);

  /* ================= 11. exports ================= */
  section("11. Governed exports");

  r = await hospA2.req("/api/exports");
  check("export templates listed", r.ok && r.body.templates?.length > 0);

  r = await hospA2.json("/api/exports", "POST", { template: "calls", maskPhone: true, includeClinical: true, days: 30 });
  check("export generated", r.ok && r.body.job?.rows >= 1, JSON.stringify(r.body).slice(0, 120));
  const job = r.body.job;
  const dl = r.body.downloadUrl;

  r = await hospA2.req(dl.replace(`token=${job.downloadToken}`, "token=wrong"));
  check("download refused without the right token", r.status === 403);

  r = await hospA2.req(dl);
  check("download works with the token", r.status === 200 && String(r.body).includes("CallID"));
  check("phone numbers masked in the export", String(r.body).includes("••••••"), "no mask found");

  r = await hospB.req(`/api/exports/${job.id}/download?token=${job.downloadToken}`);
  check("another tenant cannot download the export", r.status === 404);

  r = await hospA2.req("/api/exports");
  check("download marked on the job", r.body.jobs?.find((j) => j.id === job.id)?.downloadedAt);

  r = await hospA2.json("/api/exports", "POST", { template: "nope" });
  check("unknown template rejected", r.status === 400);

  /* ================= 12. audit trail ================= */
  section("12. Audit trail");
  r = await hospA2.req("/api/audit?limit=300");
  const actions = (r.body.logs ?? []).map((l) => l.action);
  for (const a of [
    "tenant.created", "onboarding.completed", "patient.created", "patient.updated", "user.invited",
    "user.suspended", "settings.storage.updated", "settings.voice.updated", "call.initiated",
    "escalation.forwarded", "call.completed", "call.recording.played", "export.generated", "export.downloaded",
  ]) {
    check(`audited: ${a}`, actions.includes(a));
  }

  /* ================= 13. platform console ================= */
  section("13. Platform tenant console");
  const root = client();
  r = await root.json("/api/auth/login", "POST", { email: "mayur@hospitalai.os", password: "demo1234" });
  check("platform super admin signs in", r.ok);
  r = await root.req("/api/platform/tenants");
  check("tenant list visible to platform staff", r.ok && r.body.tenants?.length >= 5, `${r.body.tenants?.length} tenants`);
  const tA = r.body.tenants.find((t) => t.id === orgA);
  check("new signup appears as a tenant", Boolean(tA));
  check("its trial state is reported", tA?.subscription?.status === "trialing");
  check("its onboarding is marked complete", tA?.onboardingComplete === true);

  r = await root.json("/api/auth/switch-org", "POST", { orgId: orgA, justification: "e2e verification of tenant access logging" });
  check("platform admin can enter a tenant workspace", r.ok);
  r = { ok: true, body: await workspace(root) };
  check("workspace switch takes effect", r.body.org?.id === orgA);
  r = await hospA2.req("/api/audit?limit=50");
  check("tenant access is audited inside the hospital's own trail", (r.body.logs ?? []).some((l) => l.action === "tenant.access"));

  /* ================= 14. demo tenants ================= */
  section("14. Preloaded demo hospitals");
  const demo = client();
  r = await demo.json("/api/auth/login", "POST", { email: "sunita.kale@democare.in", password: "demo1234" });
  check("demo hospital admin signs in", r.ok);
  r = { ok: true, body: await workspace(demo) };
  check("demo tenant has patients", (r.body.patient?.length ?? 0) > 40);
  check("demo tenant has calls", (r.body.call?.length ?? 0) > 40);
  check("demo tenant skips onboarding", r.body.subscription?.features?.length > 0);

  const doc = client();
  r = await doc.json("/api/auth/login", "POST", { email: "a.deshmukh@democare.in", password: "demo1234" });
  check("demo doctor signs in", r.ok);
  r = await doc.req("/api/users");
  check("doctor cannot manage users", r.status === 403);

  const recep = client();
  await recep.json("/api/auth/login", "POST", { email: "g.more@democare.in", password: "demo1234" });
  r = await recep.json("/api/exports", "POST", { template: "patients", maskPhone: true, includeClinical: true });
  check("receptionist export excludes clinical text despite asking", r.status === 403 || r.status === 200, `status ${r.status}`);
  if (r.status === 200) {
    const body = await recep.req(r.body.downloadUrl);
    check("clinical columns restricted for the receptionist", String(body.body).includes("[restricted]"));
  }

  const suspended = client();
  r = await suspended.json("/api/auth/login", "POST", { email: "o.bhide@democare.in", password: "demo1234" });
  check("suspended demo account cannot sign in", r.status === 403);

  /* ================= 15. logout ================= */
  section("15. Session lifecycle");
  r = await hospA2.json("/api/auth/logout", "POST");
  check("logout succeeds", r.ok);
  r = { ok: true, body: await workspace(hospA2) };
  check("session invalid after logout", r.body.authenticated === false);

  /* ================= summary ================= */
  console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  • ${f}`);
  }
  process.exit(failed ? 1 : 0);
}

run().catch((e) => {
  console.error("SUITE CRASHED", e);
  process.exit(2);
});
