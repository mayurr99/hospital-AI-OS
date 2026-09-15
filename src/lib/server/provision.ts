import * as seed from "@/lib/seed";
import { tx } from "./domain";
import { all, get, id, nowIso, records, run, settings } from "./db";
import { createUser, hashPassword } from "./auth";
import type { LanguageCode, Role } from "@/lib/types";

export const DEMO_PASSWORD = "demo1234";

export const RECORD_KINDS = [
  "facility", "department", "provider", "patient", "appointment", "call", "escalation", "task",
  "campaign", "agent", "protocol", "ward", "bed", "otSlot", "drug", "labOrder", "emergencyCase",
  "invoice", "thread", "importJob", "integration",
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/* ------------------------------------------------------------------ */
/* default per-hospital settings                                       */
/* ------------------------------------------------------------------ */

export interface StorageConfig {
  driver: "local" | "s3";
  local: { path: string };
  s3: { bucket: string; region: string; endpoint: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean };
  retentionDays: { audio: number; transcript: number; summary: number };
  encryptAtRest: boolean;
  verifiedAt: string | null;
}

export interface VoiceConfig {
  telephonyProvider: "retell" | "simulator";
  ttsProvider: "elevenlabs" | "retell" | "simulator";
  retell: { apiKey: string; agentId: string; fromNumber: string; webhookSecret: string; verifiedAt: string | null };
  elevenlabs: { apiKey: string; voiceId: string; voiceName: string; model: string; stability: number; similarity: number; verifiedAt: string | null };
  recordCalls: boolean;
  languages: LanguageCode[];
}

export interface EscalationConfig {
  mainLineNumber: string;
  transferMode: "warm" | "cold" | "conference";
  ringSeconds: number;
  onCall: { label: string; number: string; hours: string }[];
  fallbackNumber: string;
  notifyChannels: { sms: boolean; whatsapp: boolean; email: boolean; webhook: boolean };
  webhookUrl: string;
  slaMinutes: number;
  afterHoursNumber: string;
  autoForwardOnRed: boolean;
}

export const DEFAULT_STORAGE: StorageConfig = {
  driver: "local",
  local: { path: ".data/recordings" },
  s3: { bucket: "", region: "ap-south-1", endpoint: "", accessKeyId: "", secretAccessKey: "", forcePathStyle: false },
  retentionDays: { audio: 180, transcript: 365, summary: 2555 },
  encryptAtRest: true,
  verifiedAt: null,
};

export const DEFAULT_VOICE: VoiceConfig = {
  telephonyProvider: "simulator",
  ttsProvider: "simulator",
  retell: { apiKey: "", agentId: "", fromNumber: "", webhookSecret: "", verifiedAt: null },
  elevenlabs: { apiKey: "", voiceId: "", voiceName: "", model: "eleven_multilingual_v2", stability: 0.5, similarity: 0.75, verifiedAt: null },
  recordCalls: true,
  languages: ["mr", "hi", "en"],
};

export const DEFAULT_ESCALATION: EscalationConfig = {
  mainLineNumber: "",
  transferMode: "warm",
  ringSeconds: 25,
  onCall: [],
  fallbackNumber: "",
  notifyChannels: { sms: true, whatsapp: true, email: false, webhook: false },
  webhookUrl: "",
  slaMinutes: 15,
  afterHoursNumber: "",
  autoForwardOnRed: true,
};

export const ALL_FEATURES = [
  { key: "ai_receptionist", label: "AI receptionist", group: "Voice", blurb: "24×7 multilingual inbound calls, booking, rescheduling and transfers." },
  { key: "followup_agent", label: "Patient follow-up agent", group: "Voice", blurb: "Protocol-driven post-discharge calls with structured capture." },
  { key: "call_recording", label: "Call recording & storage", group: "Voice", blurb: "Recordings stored in your own bucket with retention control." },
  { key: "doctor_crm", label: "Doctor review queue", group: "Clinical", blurb: "Exception-driven queue so clinicians see only what needs them." },
  { key: "care_queue", label: "Care coordinator queue", group: "Clinical", blurb: "Callbacks, unreachable patients, medication questions, reviews." },
  { key: "escalation", label: "Clinical escalation & forwarding", group: "Clinical", blurb: "Red flags forwarded live to your main line with SLA tracking." },
  { key: "appointments", label: "Appointments & scheduling", group: "Front desk", blurb: "Doctor calendars, slot locking, reminders and no-show recovery." },
  { key: "ipd", label: "Beds & admissions (IPD)", group: "Operations", blurb: "Ward occupancy, admission and discharge-to-follow-up handover." },
  { key: "ot", label: "Operation theatre", group: "Operations", blurb: "Theatre scheduling, safety checklist and pre-op automation." },
  { key: "labs", label: "Laboratory", group: "Operations", blurb: "Orders, results and critical-value routing to the clinician." },
  { key: "pharmacy", label: "Pharmacy", group: "Operations", blurb: "Stock, reorder alerts, expiry and Schedule H tracking." },
  { key: "emergency", label: "Emergency & triage", group: "Operations", blurb: "ED board, triage priority and inbound ambulance alerts." },
  { key: "billing", label: "Billing & invoices", group: "Revenue", blurb: "Invoices, payer mix, collections and AI payment follow-up." },
  { key: "messaging", label: "WhatsApp / SMS", group: "Engagement", blurb: "Two-way patient messaging with AI-to-human handover." },
  { key: "portal", label: "Patient portal", group: "Engagement", blurb: "Self-service booking, reports, bills and privacy choices." },
  { key: "data_io", label: "Excel import / export", group: "Data", blurb: "Validated imports and governed, audited exports." },
  { key: "analytics", label: "Analytics & ROI", group: "Data", blurb: "Operational KPIs and the outcome scorecard for management." },
  { key: "integrations", label: "HIS / FHIR integration", group: "Data", blurb: "Connect your existing HIS over REST, HL7 v2 or FHIR R4." },
] as const;

export const DEFAULT_FEATURES = [
  "ai_receptionist", "followup_agent", "call_recording", "doctor_crm", "care_queue", "escalation",
  "appointments", "messaging", "analytics", "data_io",
];

/* ------------------------------------------------------------------ */
/* demo tenants — seeded once so the product is explorable immediately  */
/* ------------------------------------------------------------------ */

/**
 * Are demo tenants wanted in this deployment?
 *
 * They exist so the product is explorable the moment it starts, and they are
 * genuinely useful for that. They are also, on an internet-facing server, a
 * catastrophe: a platform super-admin and sixteen staff accounts all sharing a
 * password that the login screen prints, in a database holding real patients.
 * Seeding an empty database is therefore *opt-in*, and the intent has to be
 * stated rather than inferred from the database happening to be empty.
 *
 * Development defaults to on, so nothing about working locally changes. A
 * production build seeds only if someone sets SEED_DEMO=1 deliberately.
 */
export function demoSeedingAllowed(): boolean {
  const flag = process.env.SEED_DEMO;
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export function ensureSeeded() {
  /*
   * Seed when the *demo* hospitals are missing, not when the database is empty.
   *
   * The previous test — any organization at all — meant that once a real
   * hospital existed, demo data could never be recreated, so `reset-demo` had
   * nothing to hand back to and the only way to repair a demo polluted by test
   * runs was to destroy the whole database including real tenants.
   *
   * This is still gated on `demoSeedingAllowed()` below, so a production server
   * does not quietly grow two hospitals with a published password.
   */
  const existing = get<{ n: number }>("SELECT COUNT(*) AS n FROM organizations WHERE is_demo = 1");
  if ((existing?.n ?? 0) > 0) return;
  if (!demoSeedingAllowed()) return;

  /*
   * All of it, or none of it.
   *
   * Seeding is a few hundred inserts with fixed ids. Without a transaction a
   * failure partway leaves hospitals that exist but have no wards, no staff
   * and no patients — and because the check above then sees demo hospitals
   * and returns early, that broken half-demo becomes permanent and looks like
   * a bug in the product rather than a failed seed. One transaction makes a
   * failure a non-event: the database is exactly as it was, and the next
   * start tries again.
   */
  tx(() => {

    for (const org of seed.organizations) {
      run(
        `INSERT INTO organizations (id, name, short_name, slug, city, state, timezone, accent_color, logo_initials,
           status, plan, deployment, is_demo, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          org.id, org.name, org.shortName, org.shortName.toLowerCase().replace(/[^a-z0-9]/g, "-"), org.city, org.state,
          org.timezone, org.accentColor, org.logoInitials, org.status === "pilot" ? "trial" : "active", org.plan,
          org.deployment, 1, org.contractStart,
        ],
      );
      run(
        `INSERT INTO subscriptions (org_id, plan, status, trial_started_at, trial_ends_at, seats, voice_minutes_cap,
           voice_minutes_used, monthly_fee, features, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          org.id, org.plan, org.status === "pilot" ? "trialing" : "active",
          org.status === "pilot" ? org.contractStart : null,
          org.status === "pilot" ? new Date(Date.now() + 4 * 86400000).toISOString() : null,
          50, org.voiceMinutesIncluded, org.voiceMinutesUsed, org.monthlyFee,
          JSON.stringify(ALL_FEATURES.map((f) => f.key)), nowIso(),
        ],
      );
      run("INSERT INTO onboarding (org_id, step, completed, answers, updated_at) VALUES (?,?,?,?,?)", [
        org.id, 6, 1, JSON.stringify({ demo: true }), nowIso(),
      ]);

      settings.set(org.id, "storage", { ...DEFAULT_STORAGE, verifiedAt: nowIso() });
      settings.set(org.id, "voice", {
        ...DEFAULT_VOICE,
        languages: org.primaryLanguages,
        elevenlabs: { ...DEFAULT_VOICE.elevenlabs, voiceName: "Aarohi (demo)" },
      });
      const tel = seed.telephony.find((t) => t.orgId === org.id);
      settings.set(org.id, "escalation", {
        ...DEFAULT_ESCALATION,
        mainLineNumber: tel?.transferDestinations[0]?.number ?? "",
        fallbackNumber: tel?.fallbackNumber ?? "",
        afterHoursNumber: tel?.fallbackNumber ?? "",
        onCall: tel?.transferDestinations ?? [],
      });
      settings.set(org.id, "telephony", tel ?? null);
      settings.set(org.id, "analytics.series", seed.dailySeries[org.id] ?? []);
      settings.set(org.id, "knowledge", seed.KNOWLEDGE_BASE);
    }

    const byOrg = <T extends { orgId: string }>(arr: T[], orgId: string) => arr.filter((x) => x.orgId === orgId);
    for (const org of seed.organizations) {
      records.putMany(org.id, "facility", byOrg(seed.facilities, org.id));
      records.putMany(org.id, "department", byOrg(seed.departments, org.id));
      records.putMany(org.id, "provider", byOrg(seed.providers, org.id));
      records.putMany(org.id, "patient", byOrg(seed.patients, org.id));
      records.putMany(org.id, "appointment", byOrg(seed.appointments, org.id));
      records.putMany(org.id, "call", byOrg(seed.calls, org.id));
      records.putMany(org.id, "escalation", byOrg(seed.escalations, org.id));
      records.putMany(org.id, "task", byOrg(seed.tasks, org.id));
      records.putMany(org.id, "campaign", byOrg(seed.campaigns, org.id));
      records.putMany(org.id, "agent", byOrg(seed.agents, org.id));
      records.putMany(org.id, "protocol", byOrg(seed.protocols, org.id));
      records.putMany(org.id, "ward", byOrg(seed.wards, org.id));
      records.putMany(org.id, "bed", byOrg(seed.beds, org.id));
      records.putMany(org.id, "otSlot", byOrg(seed.otSlots, org.id));
      records.putMany(org.id, "drug", byOrg(seed.drugs, org.id));
      records.putMany(org.id, "labOrder", byOrg(seed.labOrders, org.id));
      records.putMany(org.id, "emergencyCase", byOrg(seed.emergencyCases, org.id));
      records.putMany(org.id, "invoice", byOrg(seed.invoices, org.id));
      records.putMany(org.id, "thread", byOrg(seed.threads, org.id));
      records.putMany(org.id, "importJob", byOrg(seed.importJobs, org.id));
      records.putMany(org.id, "integration", byOrg(seed.integrations, org.id));
    }

    for (const u of seed.users) {
      run(
        `INSERT INTO users (id, org_id, facility_id, department_id, provider_id, name, email, phone, role,
           password_hash, extra_perms, revoked_perms, status, mfa_enabled, last_login, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          u.id, u.orgId, u.facilityId, u.departmentId, u.providerId, u.name, u.email, u.phone, u.role,
          hashPassword(DEMO_PASSWORD), JSON.stringify(u.extraPermissions), JSON.stringify(u.revokedPermissions),
          u.status, u.mfaEnabled ? 1 : 0, u.lastLogin, u.createdAt,
        ],
      );
    }

    for (const l of seed.auditLogs) {
      run("INSERT INTO audit_logs (id, org_id, actor, actor_role, action, target, severity, ip, at) VALUES (?,?,?,?,?,?,?,?,?)", [
        l.id, l.orgId, l.actor, l.actorRole, l.action, l.target, l.severity, l.ip, l.at,
      ]);
    }
  });
}

/* ------------------------------------------------------------------ */
/* new tenant from signup                                              */
/* ------------------------------------------------------------------ */

export const TRIAL_DAYS = 7;

export function createTenant(input: {
  hospitalName: string;
  adminName: string;
  email: string;
  password: string;
  phone?: string;
  city?: string;
}) {
  const orgId = id("org");
  const short = input.hospitalName.replace(/\b(hospital|multispeciality|multi-speciality|clinic|centre|center)\b/gi, "").trim() || input.hospitalName;
  const slugBase = input.hospitalName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  let slug = slugBase || "hospital";
  let n = 1;
  while (get("SELECT id FROM organizations WHERE slug = ?", [slug])) slug = `${slugBase}-${++n}`;

  const initials = short.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "H";
  const palette = ["#0d9488", "#4f46e5", "#b45309", "#be123c", "#0369a1", "#7c3aed"];
  const accent = palette[Math.floor(Math.random() * palette.length)];

  run(
    `INSERT INTO organizations (id, name, short_name, slug, city, state, timezone, accent_color, logo_initials,
       status, plan, deployment, is_demo, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [orgId, input.hospitalName, short.slice(0, 24), slug, input.city ?? "", "", "Asia/Kolkata", accent, initials.slice(0, 2), "trial", "trial", "shared_saas", 0, nowIso()],
  );

  const trialEnds = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString();
  run(
    `INSERT INTO subscriptions (org_id, plan, status, trial_started_at, trial_ends_at, seats, voice_minutes_cap,
       voice_minutes_used, monthly_fee, features, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [orgId, "trial", "trialing", nowIso(), trialEnds, 10, 500, 0, 0, JSON.stringify(DEFAULT_FEATURES), nowIso()],
  );
  run("INSERT INTO onboarding (org_id, step, completed, answers, updated_at) VALUES (?,?,?,?,?)", [
    orgId, 0, 0, "{}", nowIso(),
  ]);

  settings.set(orgId, "storage", DEFAULT_STORAGE);
  settings.set(orgId, "voice", DEFAULT_VOICE);
  settings.set(orgId, "escalation", DEFAULT_ESCALATION);
  settings.set(orgId, "knowledge", []);
  settings.set(orgId, "analytics.series", []);

  const admin = createUser({
    orgId,
    name: input.adminName,
    email: input.email,
    phone: input.phone,
    role: "hospital_admin" as Role,
    password: input.password,
    status: "active",
    mfaEnabled: false,
  });

  return { orgId, admin, trialEnds };
}

/* ------------------------------------------------------------------ */
/* provisioning from the onboarding answers                            */
/* ------------------------------------------------------------------ */

export interface OnboardingAnswers {
  hospitalName?: string;
  city?: string;
  state?: string;
  beds?: number;
  branches?: { name: string; address: string; phone: string; beds: number }[];
  departments?: string[];
  doctors?: { name: string; department: string; speciality: string; minutes: number; fee: number }[];
  languages?: LanguageCode[];
  features?: string[];
  storageDriver?: "local" | "s3";
  voiceProvider?: "retell" | "simulator";
  mainLineNumber?: string;
  loadSampleData?: boolean;
  monthlyCallVolume?: string;
  hisVendor?: string;
  goal?: string;
}

const DEPT_CODES: Record<string, string> = {
  Cardiology: "CARD", Orthopaedics: "ORTH", "General Medicine": "GMED", "Obstetrics & Gynaecology": "OBGY",
  Paediatrics: "PEDS", Oncology: "ONCO", Nephrology: "NEPH", Pulmonology: "PULM", Neurology: "NEUR",
  Dermatology: "DERM", "ENT": "ENTD", Ophthalmology: "OPTH", Dentistry: "DENT", Gastroenterology: "GAST",
  Urology: "UROL", Psychiatry: "PSYC", Radiology: "RADI", "Pathology Lab": "PATH",
};

export function provisionTenant(orgId: string, answers: OnboardingAnswers) {
  const org = get<{ name: string; logo_initials: string }>("SELECT name, logo_initials FROM organizations WHERE id = ?", [orgId]);
  if (!org) throw new Error("Organization not found");

  if (answers.hospitalName) {
    run("UPDATE organizations SET name = ?, city = ?, state = ? WHERE id = ?", [
      answers.hospitalName, answers.city ?? "", answers.state ?? "", orgId,
    ]);
  }

  /* facilities */
  const branches = answers.branches?.length
    ? answers.branches
    : [{ name: `${answers.hospitalName ?? org.name} — Main`, address: answers.city ?? "", phone: "", beds: answers.beds ?? 50 }];
  const facilities = branches.map((b, i) => ({
    id: `fac_${orgId.slice(4)}_${i}`,
    orgId,
    name: b.name,
    address: b.address,
    phone: b.phone,
    beds: Number(b.beds) || 0,
    isPrimary: i === 0,
  }));
  records.putMany(orgId, "facility", facilities);

  /* departments across the primary facility */
  const deptNames = answers.departments?.length ? answers.departments : ["General Medicine"];
  const departments = deptNames.map((name, i) => ({
    id: `dept_${orgId.slice(4)}_${(DEPT_CODES[name] ?? name.slice(0, 4)).toLowerCase()}_${i}`,
    orgId,
    facilityId: facilities[0].id,
    name,
    code: DEPT_CODES[name] ?? name.slice(0, 4).toUpperCase(),
    type: name.includes("Lab") || name === "Radiology" ? ("diagnostic" as const) : ("clinical" as const),
  }));
  records.putMany(orgId, "department", departments);

  /* providers */
  const providers = (answers.doctors ?? []).map((doc, i) => {
    const dept = departments.find((x) => x.name === doc.department) ?? departments[0];
    return {
      id: `prov_${orgId.slice(4)}_${i}`,
      orgId,
      facilityId: dept.facilityId,
      departmentId: dept.id,
      name: doc.name,
      speciality: doc.speciality || dept.name,
      qualification: "MBBS",
      consultationMinutes: Number(doc.minutes) || 15,
      fee: Number(doc.fee) || 500,
      workingDays: [1, 2, 3, 4, 5, 6],
      startHour: 10,
      endHour: 18,
      languages: answers.languages ?? (["mr", "hi", "en"] as LanguageCode[]),
      photoHue: (i * 47) % 360,
    };
  });
  if (providers.length) records.putMany(orgId, "provider", providers);

  /* wards & beds for the primary facility */
  if ((answers.features ?? []).includes("ipd")) {
    const wards = [
      { id: `ward_${orgId.slice(4)}_gen`, orgId, facilityId: facilities[0].id, name: "General Ward", type: "general" as const, floor: 1 },
      { id: `ward_${orgId.slice(4)}_icu`, orgId, facilityId: facilities[0].id, name: "ICU", type: "icu" as const, floor: 2 },
    ];
    records.putMany(orgId, "ward", wards);
    const beds = wards.flatMap((w) =>
      Array.from({ length: w.type === "icu" ? 8 : Math.min(24, Math.max(8, Math.round((answers.beds ?? 40) / 2))) }, (_, i) => ({
        id: `bed_${w.id}_${i + 1}`,
        orgId,
        wardId: w.id,
        number: `${w.type === "icu" ? "ICU" : "GEN"}-${String(i + 1).padStart(2, "0")}`,
        status: "available" as const,
        patientId: null,
        dailyRate: w.type === "icu" ? 15000 : 3000,
      })),
    );
    records.putMany(orgId, "bed", beds);
  }

  /* a starter protocol and the two agents */
  const clinicalDept = departments.find((x) => x.type === "clinical") ?? departments[0];
  const protocolId = `prot_${orgId.slice(4)}_starter`;
  records.put(orgId, "protocol", {
    id: protocolId,
    orgId,
    name: `${clinicalDept.name} post-discharge follow-up`,
    departmentId: clinicalDept.id,
    version: "V1.0-draft",
    status: "draft",
    approvedBy: null,
    approvedAt: null,
    questions: [
      { id: "q1", text: { mr: "डिस्चार्जनंतर तब्येत कशी आहे?", hi: "डिस्चार्ज के बाद तबियत कैसी है?", en: "How has your health been since discharge?", hinglish: "Discharge ke baad tabiyat kaisi hai?" }, answerType: "choice", choices: ["Improving", "Same", "Worse"], amberIf: "Same", redIf: "Worse" },
      { id: "q2", text: { mr: "ताप आला होता का?", hi: "क्या बुखार आया?", en: "Any fever?", hinglish: "Bukhar aaya?" }, answerType: "yesno", redIf: "Yes" },
      { id: "q3", text: { mr: "औषधं वेळेवर घेतली का?", hi: "दवाइयाँ समय पर लीं?", en: "Have you taken all medicines as prescribed?", hinglish: "Medicines time pe li?" }, answerType: "yesno", amberIf: "No" },
      { id: "q4", text: { mr: "नवीन त्रास?", hi: "कोई नई शिकायत?", en: "Any new complaint?", hinglish: "Koi nayi complaint?" }, answerType: "text" },
      { id: "q5", text: { mr: "सेवेला पाचपैकी किती गुण?", hi: "सेवा को पाँच में से कितने अंक?", en: "Rate our service out of five?", hinglish: "Service ko 5 mein se kitne?" }, answerType: "scale" },
    ],
    redFlags: ["Reported health 'Worse'", "Fever above 38°C", "Breathlessness at rest", "Chest pain"],
    escalationTarget: answers.mainLineNumber ? `Main line ${answers.mainLineNumber}` : "On-call clinician",
    slaMinutes: 15,
  });

  const agents = [];
  if ((answers.features ?? []).includes("ai_receptionist")) {
    agents.push({
      id: `agent_${orgId.slice(4)}_recep`, orgId, name: `${org.logo_initials} Front Desk`, type: "receptionist",
      departmentId: null,
      purpose: "Answer inbound calls, book/reschedule/cancel appointments, answer approved FAQs, transfer to humans.",
      languages: answers.languages ?? ["mr", "hi", "en"], identityVerification: "dob_name",
      capabilities: ["Check availability", "Book appointment", "Reschedule", "Cancel", "Answer FAQ", "Send confirmation", "Human transfer"],
      knowledgeScope: "Hospital FAQ v1", protocolId: null,
      escalationTarget: "Front desk supervisor", humanTransferNumber: answers.mainLineNumber ?? "",
      recordingPolicy: "consent", retentionDays: 90, maxTurns: 30, version: "v1.0", status: "draft",
      voice: "Marathi — Aarohi (female, warm)", publishedAt: null,
    });
  }
  if ((answers.features ?? []).includes("followup_agent")) {
    agents.push({
      id: `agent_${orgId.slice(4)}_care`, orgId, name: `${org.logo_initials} Care Follow-up`, type: "care",
      departmentId: clinicalDept.id,
      purpose: "Run hospital-approved post-discharge follow-up questionnaires and escalate red flags.",
      languages: answers.languages ?? ["mr", "hi", "en"], identityVerification: "dob_name",
      capabilities: ["Verify identity", "Ask approved questions", "Capture adherence", "Record side effects", "Request appointment", "Escalate", "Human transfer"],
      knowledgeScope: `${clinicalDept.name} discharge instructions v1`, protocolId,
      escalationTarget: answers.mainLineNumber ? `Main line ${answers.mainLineNumber}` : "On-call clinician",
      humanTransferNumber: answers.mainLineNumber ?? "", recordingPolicy: "consent", retentionDays: 180,
      maxTurns: 24, version: "v1.0", status: "draft", voice: "Marathi — Aarohi (female, warm)", publishedAt: null,
    });
  }
  if (agents.length) records.putMany(orgId, "agent", agents);

  /* settings shaped by the answers */
  const storage = settings.get<StorageConfig>(orgId, "storage", DEFAULT_STORAGE);
  settings.set(orgId, "storage", { ...storage, driver: answers.storageDriver ?? storage.driver });

  const voice = settings.get<VoiceConfig>(orgId, "voice", DEFAULT_VOICE);
  settings.set(orgId, "voice", {
    ...voice,
    telephonyProvider: answers.voiceProvider ?? voice.telephonyProvider,
    languages: answers.languages ?? voice.languages,
  });

  const esc = settings.get<EscalationConfig>(orgId, "escalation", DEFAULT_ESCALATION);
  settings.set(orgId, "escalation", {
    ...esc,
    mainLineNumber: answers.mainLineNumber ?? esc.mainLineNumber,
    fallbackNumber: answers.mainLineNumber ?? esc.fallbackNumber,
    onCall: answers.mainLineNumber ? [{ label: "Main line", number: answers.mainLineNumber, hours: "24×7" }] : esc.onCall,
  });

  settings.set(orgId, "telephony", {
    orgId, provider: answers.voiceProvider === "retell" ? "Retell AI" : "Built-in simulator",
    aiNumber: answers.mainLineNumber ?? "", fallbackNumber: answers.mainLineNumber ?? "",
    transferDestinations: answers.mainLineNumber ? [{ label: "Main line", number: answers.mainLineNumber, hours: "24×7" }] : [],
    concurrentChannels: 10, sipTrunk: "—", status: answers.voiceProvider === "retell" ? "connected" : "connected",
    recordingStorage: answers.storageDriver === "s3" ? "S3-compatible bucket" : "Local encrypted volume",
  });

  /* features chosen in onboarding become the unlocked set */
  if (answers.features?.length) {
    run("UPDATE subscriptions SET features = ?, updated_at = ? WHERE org_id = ?", [
      JSON.stringify(answers.features), nowIso(), orgId,
    ]);
  }

  if (answers.loadSampleData) loadSampleData(orgId, answers);

  run("UPDATE onboarding SET completed = 1, step = 99, answers = ?, updated_at = ? WHERE org_id = ?", [
    JSON.stringify(answers), nowIso(), orgId,
  ]);

  /* a starting analytics series so the dashboard is not blank */
  const series = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10);
    return { date, calls: 0, connected: 0, completed: 0, booked: 0, escalations: 0, noShow: 0, minutes: 0 };
  });
  const existingSeries = settings.get<unknown[]>(orgId, "analytics.series", []);
  if (!existingSeries.length) settings.set(orgId, "analytics.series", series);

  return { facilities, departments, providers };
}

/* ---------------------- optional sample content -------------------- */

const FIRST = ["Rajesh", "Sunanda", "Amit", "Manisha", "Suresh", "Rekha", "Kiran", "Jyoti", "Anil", "Archana", "Vijay", "Smita"];
const LAST = ["Patil", "Jadhav", "Shinde", "Pawar", "Kulkarni", "More", "Gaikwad", "Sawant", "Chavan", "Kadam"];

export function loadSampleData(orgId: string, answers: OnboardingAnswers) {
  const facilities = records.list<{ id: string }>(orgId, "facility");
  const departments = records.list<{ id: string; name: string }>(orgId, "department");
  const providers = records.list<{ id: string; departmentId: string; consultationMinutes: number }>(orgId, "provider");
  if (!facilities.length || !departments.length) return;

  const langs = answers.languages ?? (["mr", "hi", "en"] as LanguageCode[]);
  const patients = Array.from({ length: 12 }, (_, i) => {
    const dept = departments[i % departments.length];
    const prov = providers.find((p) => p.departmentId === dept.id) ?? providers[0];
    return {
      id: `pat_${orgId.slice(4)}_${String(i + 1).padStart(3, "0")}`,
      orgId,
      facilityId: facilities[0].id,
      mrn: `MRN${String(100000 + i * 7)}`,
      name: `${FIRST[i % FIRST.length]} ${LAST[(i * 3) % LAST.length]}`,
      age: 24 + ((i * 7) % 55),
      gender: i % 2 === 0 ? "M" : "F",
      phone: `+91 9${String(800000000 + i * 137711).slice(0, 9)}`,
      language: langs[i % langs.length],
      departmentId: dept.id,
      providerId: prov?.id ?? "",
      carePathway: `${dept.name} follow-up programme`,
      diagnosis: ["Post-discharge review", "Chronic care follow-up", "Post-op recovery", "New consultation"][i % 4],
      allergies: [],
      medications: [{ name: "Tab Paracetamol", dose: "500 mg", frequency: "SOS" }],
      consent: { clinicalCalls: true, marketing: false, whatsapp: true, recording: i % 5 !== 0, version: "v1.0", updatedAt: nowIso() },
      status: (["followup", "opd", "discharged"] as const)[i % 3],
      lastContact: null,
      risk: (["green", "green", "amber", "green", "red"] as const)[i % 5],
    };
  });
  records.putMany(orgId, "patient", patients);

  const appointments = patients.slice(0, 8).map((p, i) => {
    const when = new Date();
    when.setDate(when.getDate() + (i % 5) - 1);
    when.setHours(10 + (i % 7), (i % 4) * 15, 0, 0);
    return {
      id: `apt_${orgId.slice(4)}_${i}`,
      orgId,
      facilityId: p.facilityId,
      patientId: p.id,
      providerId: p.providerId,
      departmentId: p.departmentId,
      start: when.toISOString(),
      durationMinutes: 15,
      status: i % 4 === 0 ? "completed" : "confirmed",
      source: i % 3 === 0 ? "ai_receptionist" : "reception_desk",
      reason: "Follow-up review",
      createdAt: nowIso(),
    };
  });
  records.putMany(orgId, "appointment", appointments);
}

/* ------------------------------------------------------------------ */
/* subscription helpers                                                */
/* ------------------------------------------------------------------ */

export interface SubscriptionRow {
  org_id: string;
  plan: string;
  status: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  seats: number;
  voice_minutes_cap: number;
  voice_minutes_used: number;
  monthly_fee: number;
  features: string;
  updated_at: string;
}

export function getSubscription(orgId: string) {
  const row = get<SubscriptionRow>("SELECT * FROM subscriptions WHERE org_id = ?", [orgId]);
  if (!row) return null;
  const trialEndsAt = row.trial_ends_at;
  const daysLeft = trialEndsAt ? Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000) : null;
  return {
    orgId: row.org_id,
    plan: row.plan,
    status: daysLeft !== null && daysLeft <= 0 && row.status === "trialing" ? "trial_expired" : row.status,
    trialStartedAt: row.trial_started_at,
    trialEndsAt,
    trialDaysLeft: daysLeft,
    seats: row.seats,
    voiceMinutesCap: row.voice_minutes_cap,
    voiceMinutesUsed: row.voice_minutes_used,
    monthlyFee: row.monthly_fee,
    features: JSON.parse(row.features || "[]") as string[],
  };
}

export function listOrganizations() {
  return all<Record<string, unknown>>("SELECT * FROM organizations ORDER BY created_at DESC");
}
