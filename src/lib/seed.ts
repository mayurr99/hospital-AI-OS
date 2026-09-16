import type {
  Agent, Appointment, AuditLog, Bed, CallSession, Campaign, Department, Drug, EmergencyCase,
  Escalation, Facility, Incident, ImportJob, Integration, Invoice, LabOrder, LanguageCode,
  Organization, OTSlot, Patient, Protocol, Provider, Task, TelephonyConfig, Thread, User, Ward,
} from "./types";

/* ------------------------------------------------------------------ */
/* deterministic pseudo-random so the demo looks the same every reload */
/* ------------------------------------------------------------------ */
let _s = 20260913;
function rnd() {
  _s = (_s * 1103515245 + 12345) % 2147483648;
  return _s / 2147483648;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}
function int(min: number, max: number) {
  return Math.floor(rnd() * (max - min + 1)) + min;
}
function resetSeed() {
  _s = 20260913;
}

/* dates are relative to "today" so the demo always looks live */
const DAY = 86400000;
export const NOW = new Date();
NOW.setSeconds(0, 0);
function iso(dayOffset: number, hour = 9, minute = 0) {
  const d = new Date(NOW.getTime() + dayOffset * DAY);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}
function isoMinutesAgo(m: number) {
  return new Date(NOW.getTime() - m * 60000).toISOString();
}

/* ------------------------------------------------------------------ */
/* organizations                                                       */
/* ------------------------------------------------------------------ */
export const organizations: Organization[] = [
  {
    id: "org_democare",
    name: "DemoCare Multispeciality Hospital",
    shortName: "DemoCare",
    plan: "enterprise",
    city: "Pune",
    state: "Maharashtra",
    timezone: "Asia/Kolkata",
    primaryLanguages: ["mr", "hi", "en"],
    accentColor: "#0d9488",
    logoInitials: "DC",
    status: "active",
    contractStart: iso(-214),
    voiceMinutesIncluded: 60000,
    voiceMinutesUsed: 41280,
    monthlyFee: 525000,
    deployment: "dedicated_vpc",
    integrationStatus: "live",
    openIncidents: 1,
  },
  {
    id: "org_sahyadri",
    name: "Sahyadri City Hospital",
    shortName: "Sahyadri",
    plan: "care",
    city: "Nashik",
    state: "Maharashtra",
    timezone: "Asia/Kolkata",
    primaryLanguages: ["mr", "hi", "en"],
    accentColor: "#4f46e5",
    logoInitials: "SC",
    status: "pilot",
    contractStart: iso(-46),
    voiceMinutesIncluded: 12000,
    voiceMinutesUsed: 4310,
    monthlyFee: 190000,
    deployment: "shared_saas",
    integrationStatus: "in_progress",
    openIncidents: 0,
  },
  {
    id: "org_lifeline",
    name: "Lifeline Hospitals Group",
    shortName: "Lifeline",
    plan: "enterprise",
    city: "Mumbai",
    state: "Maharashtra",
    timezone: "Asia/Kolkata",
    primaryLanguages: ["hi", "en", "mr"],
    accentColor: "#b45309",
    logoInitials: "LH",
    status: "active",
    contractStart: iso(-410),
    voiceMinutesIncluded: 180000,
    voiceMinutesUsed: 162900,
    monthlyFee: 1500000,
    deployment: "on_prem",
    integrationStatus: "live",
    openIncidents: 2,
  },
];

/* ------------------------------------------------------------------ */
/* facilities & departments                                            */
/* ------------------------------------------------------------------ */
export const facilities: Facility[] = [
  { id: "fac_dc_main", orgId: "org_democare", name: "DemoCare — Kothrud (Main)", address: "Paud Road, Kothrud, Pune 411038", phone: "+91 20 4000 1000", beds: 240, isPrimary: true },
  { id: "fac_dc_hadapsar", orgId: "org_democare", name: "DemoCare — Hadapsar", address: "Magarpatta Road, Hadapsar, Pune 411028", phone: "+91 20 4000 2000", beds: 90, isPrimary: false },
  { id: "fac_sc_main", orgId: "org_sahyadri", name: "Sahyadri City — College Road", address: "College Road, Nashik 422005", phone: "+91 253 660 1000", beds: 120, isPrimary: true },
  { id: "fac_lh_main", orgId: "org_lifeline", name: "Lifeline — Andheri", address: "Andheri East, Mumbai 400069", phone: "+91 22 6100 1000", beds: 420, isPrimary: true },
];

const DEPT_DEFS = [
  { name: "Cardiology", code: "CARD", type: "clinical" as const },
  { name: "Orthopaedics", code: "ORTH", type: "clinical" as const },
  { name: "General Medicine", code: "GMED", type: "clinical" as const },
  { name: "Obstetrics & Gynaecology", code: "OBGY", type: "clinical" as const },
  { name: "Paediatrics", code: "PEDS", type: "clinical" as const },
  { name: "Oncology", code: "ONCO", type: "clinical" as const },
  { name: "Nephrology", code: "NEPH", type: "clinical" as const },
  { name: "Pulmonology", code: "PULM", type: "clinical" as const },
  { name: "Radiology", code: "RADI", type: "diagnostic" as const },
  { name: "Pathology Lab", code: "PATH", type: "diagnostic" as const },
];

export const departments: Department[] = [];
for (const fac of facilities) {
  const defs = fac.id === "fac_dc_main" || fac.id === "fac_lh_main" ? DEPT_DEFS : DEPT_DEFS.slice(0, 6);
  for (const d of defs) {
    departments.push({
      id: `dept_${fac.id}_${d.code.toLowerCase()}`,
      orgId: fac.orgId,
      facilityId: fac.id,
      name: d.name,
      code: d.code,
      type: d.type,
    });
  }
}

/* ------------------------------------------------------------------ */
/* providers                                                           */
/* ------------------------------------------------------------------ */
const DOCTOR_NAMES = [
  "Dr. Aniket Deshmukh", "Dr. Sneha Kulkarni", "Dr. Rahul Joshi", "Dr. Meera Pawar",
  "Dr. Vikram Shinde", "Dr. Priya Bhosale", "Dr. Sameer Gokhale", "Dr. Anjali Rane",
  "Dr. Nikhil Chavan", "Dr. Kavita Sathe", "Dr. Rohan Patil", "Dr. Deepa Mhatre",
  "Dr. Ajay Kadam", "Dr. Swati Naik", "Dr. Imran Shaikh", "Dr. Neha Gupta",
  "Dr. Prashant Jadhav", "Dr. Ritu Agarwal", "Dr. Mahesh Salunke", "Dr. Pooja Iyer",
];
const QUALS = ["MBBS, MD, DM", "MBBS, MS", "MBBS, MD", "MBBS, DNB", "MBBS, MS, MCh"];

export const providers: Provider[] = [];
resetSeed();
let docIdx = 0;
for (const dept of departments.filter((d) => d.type === "clinical")) {
  const count = dept.code === "CARD" || dept.code === "GMED" ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const name = DOCTOR_NAMES[docIdx % DOCTOR_NAMES.length];
    docIdx++;
    providers.push({
      id: `prov_${dept.id}_${i}`,
      orgId: dept.orgId,
      facilityId: dept.facilityId,
      departmentId: dept.id,
      name: docIdx > DOCTOR_NAMES.length ? `${name} (${dept.code})` : name,
      speciality: dept.name,
      qualification: pick(QUALS),
      consultationMinutes: pick([15, 20, 30]),
      fee: pick([600, 800, 1000, 1500, 2000]),
      workingDays: [1, 2, 3, 4, 5, 6],
      startHour: pick([9, 10, 11]),
      endHour: pick([16, 17, 18, 19]),
      languages: ["mr", "hi", "en"],
      photoHue: int(0, 359),
    });
  }
}

/* ------------------------------------------------------------------ */
/* users                                                               */
/* ------------------------------------------------------------------ */
export const users: User[] = [
  {
    id: "usr_platform_root", orgId: null, facilityId: null, departmentId: null, providerId: null,
    name: "Mayur Rathod", email: "mayur@hospitalai.os", phone: "+91 98200 00001",
    role: "super_admin", extraPermissions: [], revokedPermissions: [], status: "active",
    mfaEnabled: false, mfaEnrolled: false, lastLogin: isoMinutesAgo(12), createdAt: iso(-420),
  },
  {
    id: "usr_dc_admin", orgId: "org_democare", facilityId: "fac_dc_main", departmentId: null, providerId: null,
    name: "Sunita Kale", email: "sunita.kale@democare.in", phone: "+91 98200 10001",
    role: "hospital_admin", extraPermissions: [], revokedPermissions: [], status: "active",
    mfaEnabled: false, mfaEnrolled: false, lastLogin: isoMinutesAgo(38), createdAt: iso(-210),
  },
  {
    id: "usr_dc_doctor", orgId: "org_democare", facilityId: "fac_dc_main",
    departmentId: "dept_fac_dc_main_card", providerId: "prov_dept_fac_dc_main_card_0",
    name: "Dr. Aniket Deshmukh", email: "a.deshmukh@democare.in", phone: "+91 98200 10002",
    role: "doctor", extraPermissions: [], revokedPermissions: [], status: "active",
    mfaEnabled: false, mfaEnrolled: false, lastLogin: isoMinutesAgo(95), createdAt: iso(-208),
  },
  {
    id: "usr_dc_nurse", orgId: "org_democare", facilityId: "fac_dc_main",
    departmentId: "dept_fac_dc_main_card", providerId: null,
    name: "Rupali Tambe", email: "r.tambe@democare.in", phone: "+91 98200 10003",
    role: "nurse", extraPermissions: ["calls.takeover"], revokedPermissions: [], status: "active",
    mfaEnabled: false, mfaEnrolled: false, lastLogin: isoMinutesAgo(7), createdAt: iso(-200),
  },
  {
    id: "usr_dc_reception", orgId: "org_democare", facilityId: "fac_dc_main", departmentId: null, providerId: null,
    name: "Ganesh More", email: "g.more@democare.in", phone: "+91 98200 10004",
    role: "receptionist", extraPermissions: [], revokedPermissions: [], status: "active",
    mfaEnabled: false, mfaEnrolled: false, lastLogin: isoMinutesAgo(3), createdAt: iso(-195),
  },
  {
    id: "usr_dc_pharm", orgId: "org_democare", facilityId: "fac_dc_main", departmentId: null, providerId: null,
    name: "Asha Nair", email: "a.nair@democare.in", phone: "+91 98200 10005",
    role: "pharmacist", extraPermissions: [], revokedPermissions: [], status: "active",
    mfaEnabled: false, mfaEnrolled: false, lastLogin: isoMinutesAgo(140), createdAt: iso(-180),
  },
  {
    id: "usr_dc_lab", orgId: "org_democare", facilityId: "fac_dc_main", departmentId: null, providerId: null,
    name: "Sachin Dhumal", email: "s.dhumal@democare.in", phone: "+91 98200 10006",
    role: "lab_tech", extraPermissions: [], revokedPermissions: [], status: "active",
    mfaEnabled: false, mfaEnrolled: false, lastLogin: isoMinutesAgo(62), createdAt: iso(-176),
  },
  {
    id: "usr_dc_billing", orgId: "org_democare", facilityId: "fac_dc_main", departmentId: null, providerId: null,
    name: "Farida Khan", email: "f.khan@democare.in", phone: "+91 98200 10007",
    role: "billing", extraPermissions: [], revokedPermissions: [], status: "active",
    mfaEnabled: false, mfaEnrolled: false, lastLogin: isoMinutesAgo(22), createdAt: iso(-170),
  },
  {
    id: "usr_dc_doctor2", orgId: "org_democare", facilityId: "fac_dc_main",
    departmentId: "dept_fac_dc_main_orth", providerId: "prov_dept_fac_dc_main_orth_0",
    name: "Dr. Rahul Joshi", email: "r.joshi@democare.in", phone: "+91 98200 10008",
    role: "doctor", extraPermissions: [], revokedPermissions: ["calls.listen"], status: "active",
    mfaEnabled: false, mfaEnrolled: false, lastLogin: isoMinutesAgo(420), createdAt: iso(-160),
  },
  {
    id: "usr_dc_nurse2", orgId: "org_democare", facilityId: "fac_dc_hadapsar", departmentId: null, providerId: null,
    name: "Vaishali Pandit", email: "v.pandit@democare.in", phone: "+91 98200 10009",
    role: "nurse", extraPermissions: [], revokedPermissions: [], status: "invited",
    mfaEnabled: false, mfaEnrolled: false, lastLogin: null, createdAt: iso(-4),
  },
  {
    id: "usr_dc_recep2", orgId: "org_democare", facilityId: "fac_dc_hadapsar", departmentId: null, providerId: null,
    name: "Omkar Bhide", email: "o.bhide@democare.in", phone: "+91 98200 10010",
    role: "receptionist", extraPermissions: [], revokedPermissions: [], status: "suspended",
    mfaEnabled: false, mfaEnrolled: false, lastLogin: iso(-31, 11), createdAt: iso(-150),
  },
  {
    id: "usr_sc_admin", orgId: "org_sahyadri", facilityId: "fac_sc_main", departmentId: null, providerId: null,
    name: "Nitin Wagh", email: "nitin.wagh@sahyadricity.in", phone: "+91 98200 20001",
    role: "hospital_admin", extraPermissions: [], revokedPermissions: [], status: "active",
    mfaEnabled: false, mfaEnrolled: false, lastLogin: isoMinutesAgo(210), createdAt: iso(-44),
  },
  {
    id: "usr_sc_doctor", orgId: "org_sahyadri", facilityId: "fac_sc_main",
    departmentId: "dept_fac_sc_main_card", providerId: "prov_dept_fac_sc_main_card_0",
    name: "Dr. Kavita Sathe", email: "k.sathe@sahyadricity.in", phone: "+91 98200 20002",
    role: "doctor", extraPermissions: [], revokedPermissions: [], status: "active",
    mfaEnabled: false, mfaEnrolled: false, lastLogin: isoMinutesAgo(310), createdAt: iso(-42),
  },
  {
    id: "usr_patient_demo", orgId: "org_democare", facilityId: "fac_dc_main", departmentId: null, providerId: null,
    name: "Rajesh Patil", email: "rajesh.patil@example.com", phone: "+91 99000 11001",
    role: "patient", extraPermissions: [], revokedPermissions: [], status: "active",
    mfaEnabled: false, mfaEnrolled: false, lastLogin: isoMinutesAgo(55), createdAt: iso(-120),
  },
];

/* ------------------------------------------------------------------ */
/* patients                                                            */
/* ------------------------------------------------------------------ */
const FIRST_M = ["Rajesh", "Sandeep", "Amit", "Suresh", "Prakash", "Vijay", "Mohan", "Kiran", "Anil", "Dattatray", "Ravi", "Yogesh", "Santosh", "Manoj", "Bhushan", "Arun", "Tushar", "Hemant"];
const FIRST_F = ["Sunanda", "Manisha", "Rekha", "Shalini", "Vidya", "Jyoti", "Archana", "Sarika", "Ujwala", "Nanda", "Smita", "Trupti", "Lata", "Kalpana", "Madhuri", "Seema"];
const LAST = ["Patil", "Jadhav", "Shinde", "Pawar", "Kulkarni", "Deshpande", "More", "Gaikwad", "Sawant", "Bhosale", "Chavan", "Kadam", "Thorat", "Salunke", "Nikam", "Wagh"];

const PATHWAYS: Record<string, { diag: string[]; meds: { name: string; dose: string; frequency: string }[]; pathway: string }> = {
  CARD: {
    diag: ["Post-angioplasty (PTCA)", "Acute MI — post discharge", "Hypertension — uncontrolled", "Congestive heart failure", "Post CABG day 14"],
    meds: [{ name: "Tab Ecosprin", dose: "75 mg", frequency: "OD after lunch" }, { name: "Tab Atorvastatin", dose: "40 mg", frequency: "OD at night" }, { name: "Tab Metoprolol", dose: "25 mg", frequency: "BD" }],
    pathway: "Cardiac post-discharge follow-up (Day 3 / 7 / 14 / 30)",
  },
  ORTH: {
    diag: ["Total knee replacement — post op", "Fracture tibia — POP", "Lumbar disc prolapse", "Rotator cuff repair", "Hip arthroplasty"],
    meds: [{ name: "Tab Aceclofenac", dose: "100 mg", frequency: "BD after food" }, { name: "Cap Calcium + D3", dose: "500 mg", frequency: "OD" }],
    pathway: "Ortho post-op recovery & physiotherapy adherence",
  },
  GMED: {
    diag: ["Type 2 diabetes mellitus", "Dengue — post discharge", "COPD exacerbation", "Anaemia under evaluation", "Thyroid disorder"],
    meds: [{ name: "Tab Metformin", dose: "500 mg", frequency: "BD" }, { name: "Tab Telmisartan", dose: "40 mg", frequency: "OD" }],
    pathway: "Chronic disease adherence programme",
  },
  OBGY: {
    diag: ["Post LSCS day 7", "Antenatal — 32 weeks", "PCOS follow-up", "Post normal delivery"],
    meds: [{ name: "Tab Ferrous ascorbate", dose: "100 mg", frequency: "OD" }, { name: "Cap Calcium", dose: "500 mg", frequency: "BD" }],
    pathway: "Maternal care follow-up programme",
  },
  PEDS: {
    diag: ["Bronchiolitis — post discharge", "Immunisation due", "Febrile seizure follow-up", "Neonatal jaundice review"],
    meds: [{ name: "Syrup Paracetamol", dose: "250 mg/5 ml", frequency: "SOS" }],
    pathway: "Paediatric discharge & immunisation follow-up",
  },
  ONCO: {
    diag: ["Chemotherapy cycle 3", "Post mastectomy review", "Radiotherapy — week 2"],
    meds: [{ name: "Tab Ondansetron", dose: "4 mg", frequency: "TDS SOS" }, { name: "Tab Pantoprazole", dose: "40 mg", frequency: "OD" }],
    pathway: "Oncology chemotherapy tolerance monitoring",
  },
  NEPH: { diag: ["CKD stage 3", "Post dialysis review", "Renal calculus"], meds: [{ name: "Tab Cinacalcet", dose: "30 mg", frequency: "OD" }], pathway: "Nephrology dialysis adherence" },
  PULM: { diag: ["Asthma — step up therapy", "Post pneumonia review", "OSA on CPAP"], meds: [{ name: "MDI Budesonide", dose: "200 mcg", frequency: "BD" }], pathway: "Respiratory inhaler-technique follow-up" },
};

export const patients: Patient[] = [];
resetSeed();
let pCount = 0;
for (const org of organizations) {
  const orgFacilities = facilities.filter((f) => f.orgId === org.id);
  const n = org.id === "org_democare" ? 46 : org.id === "org_sahyadri" ? 22 : 18;
  for (let i = 0; i < n; i++) {
    const fac = pick(orgFacilities);
    const clinicalDepts = departments.filter((d) => d.facilityId === fac.id && d.type === "clinical");
    const dept = pick(clinicalDepts);
    const deptProviders = providers.filter((p) => p.departmentId === dept.id);
    const prov = deptProviders.length ? pick(deptProviders) : providers[0];
    const gender: "M" | "F" = rnd() > 0.48 ? "M" : "F";
    const first = gender === "M" ? pick(FIRST_M) : pick(FIRST_F);
    const path = PATHWAYS[dept.code] ?? PATHWAYS.GMED;
    const status = pick<Patient["status"]>(["followup", "followup", "opd", "ipd", "discharged", "followup"]);
    const risk = rnd() > 0.88 ? "red" : rnd() > 0.7 ? "amber" : "green";
    pCount++;
    patients.push({
      id: `pat_${org.id.slice(4)}_${String(pCount).padStart(3, "0")}`,
      orgId: org.id,
      facilityId: fac.id,
      mrn: `${org.logoInitials}${String(100000 + pCount * 37).slice(0, 6)}`,
      name: i === 0 && org.id === "org_democare" ? "Rajesh Patil" : `${first} ${pick(LAST)}`,
      age: int(19, 82),
      gender,
      phone: `+91 9${int(1000000000, 9999999999)}`.slice(0, 14),
      language: pick<LanguageCode>(["mr", "mr", "hi", "en", "hinglish"]),
      departmentId: dept.id,
      providerId: prov.id,
      carePathway: path.pathway,
      diagnosis: pick(path.diag),
      allergies: rnd() > 0.8 ? [pick(["Penicillin", "Sulfa drugs", "Dust", "Iodine contrast"])] : [],
      medications: path.meds,
      consent: {
        clinicalCalls: rnd() > 0.05,
        marketing: rnd() > 0.6,
        whatsapp: rnd() > 0.2,
        recording: rnd() > 0.15,
        version: "v2.1",
        updatedAt: iso(-int(1, 90), 10),
      },
      status,
      admittedAt: status === "ipd" ? iso(-int(1, 6), int(8, 20)) : undefined,
      dischargedAt: status === "discharged" || status === "followup" ? iso(-int(1, 21), int(10, 18)) : undefined,
      lastContact: rnd() > 0.2 ? iso(-int(0, 14), int(9, 19)) : null,
      risk,
      abhaId: rnd() > 0.5 ? `${int(10, 99)}-${int(1000, 9999)}-${int(1000, 9999)}-${int(1000, 9999)}` : undefined,
    });
  }
}

/* ------------------------------------------------------------------ */
/* appointments                                                        */
/* ------------------------------------------------------------------ */
export const appointments: Appointment[] = [];
resetSeed();
let aCount = 0;
for (const org of organizations) {
  const orgPatients = patients.filter((p) => p.orgId === org.id);
  const count = org.id === "org_democare" ? 90 : 40;
  for (let i = 0; i < count; i++) {
    const pat = pick(orgPatients);
    const prov = providers.find((p) => p.id === pat.providerId)!;
    const dayOffset = int(-10, 12);
    const hour = int(prov.startHour, Math.max(prov.startHour, prov.endHour - 1));
    const minute = pick([0, 15, 30, 45]);
    const past = dayOffset < 0;
    aCount++;
    appointments.push({
      id: `apt_${String(aCount).padStart(4, "0")}`,
      orgId: org.id,
      facilityId: pat.facilityId,
      patientId: pat.id,
      providerId: prov.id,
      departmentId: pat.departmentId,
      start: iso(dayOffset, hour, minute),
      durationMinutes: prov.consultationMinutes,
      status: past
        ? pick<Appointment["status"]>(["completed", "completed", "completed", "no_show", "cancelled"])
        : pick<Appointment["status"]>(["booked", "confirmed", "confirmed", "booked"]),
      source: pick<Appointment["source"]>(["ai_receptionist", "ai_receptionist", "reception_desk", "patient_portal", "whatsapp", "followup_call"]),
      reason: pick(["New consultation", "Follow-up review", "Report discussion", "Post-op check", "Second opinion", "Dressing change"]),
      createdAt: iso(dayOffset - int(1, 8), int(9, 18)),
    });
  }
}

/* ------------------------------------------------------------------ */
/* transcripts & calls                                                 */
/* ------------------------------------------------------------------ */
const MR_FOLLOWUP: { t: TranscriptSeed[] } = {
  t: [
    { s: "agent", x: "नमस्कार, मी डेमोकेअर हॉस्पिटलची सहाय्यक बोलत आहे. मी श्री. {name} यांच्याशी बोलत आहे का?", tr: "Hello, I am the DemoCare Hospital assistant. Am I speaking with Mr. {name}?", a: 0 },
    { s: "patient", x: "हो, मीच बोलतोय.", tr: "Yes, this is me.", a: 5 },
    { s: "agent", x: "धन्यवाद. सुरक्षिततेसाठी कृपया आपली जन्मतारीख सांगाल का?", tr: "Thank you. For verification, could you please confirm your date of birth?", a: 9 },
    { s: "patient", x: "चौदा मार्च एकोणीसशे अठ्ठावन्न.", tr: "14th March 1958.", a: 15 },
    { s: "system", x: "Identity verified against MRN. Clinical context unlocked (purpose: cardiac follow-up).", a: 17 },
    { s: "agent", x: "डिस्चार्ज नंतर तुमची तब्येत कशी आहे?", tr: "How has your health been since discharge?", a: 20 },
    { s: "patient", x: "बरं वाटतंय, पण काल रात्री थोडा छातीत दुखत होतं.", tr: "Feeling better, but last night I had some chest pain.", a: 27, flag: "red" },
    { s: "system", x: "RED FLAG — protocol CARD-PD-v3.2 rule R1: new chest pain after cardiac discharge.", a: 28, flag: "red" },
    { s: "agent", x: "हे महत्त्वाचं आहे. दुखणं किती वेळ होतं आणि आत्ता कसं वाटतंय?", tr: "That is important. How long did the pain last and how do you feel now?", a: 32 },
    { s: "patient", x: "साधारण दहा मिनिटं. आत्ता ठीक आहे पण दम लागतो.", tr: "About ten minutes. It's fine now but I get breathless.", a: 41, flag: "red" },
    { s: "agent", x: "मी आत्ताच तुमच्या डॉक्टरांच्या टीमला कळवत आहे. कृपया फोन ठेवू नका, मी नर्सशी जोडते.", tr: "I am informing your doctor's team right now. Please stay on the line, I am connecting you to a nurse.", a: 48 },
    { s: "system", x: "Escalation ESC created · assigned to Cardiology on-call · warm transfer initiated.", a: 52, flag: "red" },
  ],
};
const HI_ADHERENCE: { t: TranscriptSeed[] } = {
  t: [
    { s: "agent", x: "नमस्ते, मैं डेमोकेयर अस्पताल से बोल रही हूँ। क्या मेरी बात {name} जी से हो रही है?", tr: "Hello, I'm calling from DemoCare Hospital. Am I speaking with {name}?", a: 0 },
    { s: "patient", x: "हाँ जी बोलिए।", tr: "Yes, please go ahead.", a: 4 },
    { s: "agent", x: "क्या आप दवाइयाँ नियमित ले रहे हैं?", tr: "Are you taking your medicines regularly?", a: 10 },
    { s: "patient", x: "हाँ, लेकिन कल रात की खुराक छूट गई थी।", tr: "Yes, but I missed last night's dose.", a: 17, flag: "amber" },
    { s: "agent", x: "ठीक है, मैंने यह दर्ज कर लिया है। कोई साइड इफेक्ट महसूस हुआ?", tr: "Alright, I've recorded that. Any side effects?", a: 23 },
    { s: "patient", x: "थोड़ी कमज़ोरी लगती है।", tr: "I feel a little weak.", a: 30, flag: "amber" },
    { s: "agent", x: "मैं आपकी नर्स को यह बता दूँगी। क्या अगली अपॉइंटमेंट बुक करूँ?", tr: "I'll pass this to your nurse. Shall I book your next appointment?", a: 36 },
    { s: "patient", x: "हाँ, अगले हफ्ते शनिवार को।", tr: "Yes, next Saturday.", a: 43 },
    { s: "system", x: "Appointment request created → scheduling service · review task assigned to care coordinator.", a: 47, flag: "amber" },
  ],
};
const EN_BOOKING: { t: TranscriptSeed[] } = {
  t: [
    { s: "agent", x: "Good morning, DemoCare Multispeciality Hospital. How may I help you?", a: 0 },
    { s: "patient", x: "I want to book an appointment with a cardiologist.", a: 5 },
    { s: "agent", x: "Certainly. Is this for yourself, and have you visited us before?", a: 10 },
    { s: "patient", x: "Yes, for myself. I came last month.", a: 15 },
    { s: "system", x: "Patient matched on mobile number · administrative scope only (no clinical history exposed).", a: 17 },
    { s: "agent", x: "Thank you. Dr. Aniket Deshmukh has slots on Thursday at 11:15 am or Friday at 4:30 pm. Which suits you?", a: 23 },
    { s: "patient", x: "Thursday 11:15 works.", a: 29 },
    { s: "system", x: "Slot held for 90 seconds (lock apt_hold) → availability re-checked → appointment created.", a: 32 },
    { s: "agent", x: "Booked. Your appointment ID is DC-48213 for Thursday 11:15 am with Dr. Deshmukh. I have sent a WhatsApp confirmation.", a: 38 },
    { s: "patient", x: "Thank you.", a: 45 },
  ],
};
const MR_UNREACHABLE: { t: TranscriptSeed[] } = {
  t: [
    { s: "system", x: "Outbound dial attempt 2 of 3 · no answer after 35 seconds.", a: 0 },
    { s: "system", x: "Retry policy: next attempt in 4 hours within consent window (09:00–19:00).", a: 35 },
  ],
};

type TranscriptSeed = { s: "agent" | "patient" | "system" | "staff"; x: string; tr?: string; a: number; flag?: "red" | "amber" };

const CALL_TEMPLATES: {
  key: string; lang: LanguageCode; type: "receptionist" | "care"; seed: TranscriptSeed[];
  risk: "green" | "amber" | "red"; outcome: string; status: CallSession["status"]; dur: number;
  structured: Record<string, string>; summary: string;
}[] = [
  { key: "card_red", lang: "mr" as LanguageCode, type: "care" as const, seed: MR_FOLLOWUP.t, risk: "red" as const, outcome: "Red flag — chest pain, transferred to on-call", status: "transferred" as const, dur: 186,
    structured: { "General health": "Improving", "Chest pain": "Yes — new, 10 min episode", "Breathlessness": "Yes, on exertion", "Medication taken": "Yes", "Missed dose": "None", "Doctor callback requested": "Escalated", "Workflow outcome": "RED — urgent escalation" },
    summary: "Post-discharge cardiac follow-up. Patient reports a new 10-minute chest pain episode last night with exertional breathlessness. Medication adherence intact. Red flag rule R1 triggered; warm transfer to cardiology on-call completed and escalation raised." },
  { key: "adherence_amber", lang: "hi" as LanguageCode, type: "care" as const, seed: HI_ADHERENCE.t, risk: "amber" as const, outcome: "Missed dose + weakness — review task created", status: "completed" as const, dur: 61,
    structured: { "General health": "Stable", "Pain": "2/10", "Medication taken": "Partially", "Missed dose": "One evening dose", "Reported side effect": "Mild weakness", "New complaint": "Weakness", "Appointment": "Requested — next Saturday", "Patient feedback": "4/5", "Workflow outcome": "AMBER — clinician review" },
    summary: "Adherence follow-up. One missed evening dose and mild weakness reported. No red flags. Appointment requested for next Saturday; review task assigned to care coordinator." },
  { key: "booking", lang: "en" as LanguageCode, type: "receptionist" as const, seed: EN_BOOKING.t, risk: "green" as const, outcome: "Appointment booked — DC-48213", status: "completed" as const, dur: 52,
    structured: { "Intent": "Book appointment", "Speciality": "Cardiology", "Doctor": "Dr. Aniket Deshmukh", "Slot": "Thursday 11:15", "Confirmation": "WhatsApp sent", "Workflow outcome": "GREEN — routine" },
    summary: "Inbound receptionist call. Patient booked a cardiology consultation with Dr. Deshmukh for Thursday 11:15. Slot lock applied, availability re-checked, appointment created and WhatsApp confirmation dispatched." },
  { key: "unreachable", lang: "mr" as LanguageCode, type: "care" as const, seed: MR_UNREACHABLE.t, risk: "green" as const, outcome: "No answer — retry scheduled", status: "no_answer" as const, dur: 35,
    structured: { "Attempt": "2 of 3", "Next retry": "In 4 hours", "Workflow outcome": "Unreachable queue" },
    summary: "Outbound follow-up not connected. Attempt 2 of 3 unanswered; retry scheduled inside the consent window. Patient moved to the unreachable queue for the care coordinator." },
];

export const calls: CallSession[] = [];
resetSeed();
let cCount = 0;
for (const org of organizations) {
  const orgPatients = patients.filter((p) => p.orgId === org.id);
  const count = org.id === "org_democare" ? 60 : 26;
  for (let i = 0; i < count; i++) {
    const pat = pick(orgPatients);
    const tpl = i < 4 && org.id === "org_democare" ? CALL_TEMPLATES[i] : pick(CALL_TEMPLATES);
    const minutesAgo = int(5, 60 * 24 * 6);
    cCount++;
    calls.push({
      id: `call_${String(cCount).padStart(4, "0")}`,
      orgId: org.id,
      facilityId: pat.facilityId,
      patientId: pat.id,
      patientName: pat.name,
      phone: pat.phone,
      direction: tpl.type === "receptionist" ? "inbound" : "outbound",
      agentId: tpl.type === "receptionist" ? `agent_${org.id}_recep` : `agent_${org.id}_care`,
      agentType: tpl.type,
      language: tpl.lang,
      startedAt: isoMinutesAgo(minutesAgo),
      durationSeconds: tpl.dur + int(-12, 40),
      status: tpl.status,
      outcome: tpl.outcome,
      risk: tpl.risk,
      reviewStatus: tpl.risk === "green" ? "not_required" : rnd() > 0.45 ? "pending" : "reviewed",
      sentimentScore: tpl.risk === "red" ? 3 : int(3, 5),
      transcript: tpl.seed.map((t) => ({
        speaker: t.s,
        text: t.x.replace("{name}", pat.name.split(" ")[0]),
        translation: t.tr,
        atSecond: t.a,
        flag: t.flag,
      })),
      structured: tpl.structured,
      summary: tpl.summary,
      recordingAvailable: pat.consent.recording,
      costRupees: Math.round((tpl.dur / 60) * 4.2 * 100) / 100,
      agentVersion: "v3.4",
      protocolVersion: tpl.type === "care" ? "CARD-PD-v3.2" : "RECEP-v2.0",
      modelVersion: "voice-orchestrator-2026.08",
    });
  }
}
calls.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));

/* ------------------------------------------------------------------ */
/* escalations & tasks                                                 */
/* ------------------------------------------------------------------ */
export const escalations: Escalation[] = [];
resetSeed();
let eCount = 0;
for (const call of calls.filter((c) => c.risk !== "green").slice(0, 26)) {
  eCount++;
  const assignable = users.filter((u) => u.orgId === call.orgId && (u.role === "doctor" || u.role === "nurse"));
  const status = eCount <= 4 ? "open" : eCount <= 9 ? "acknowledged" : "resolved";
  escalations.push({
    id: `esc_${String(eCount).padStart(3, "0")}`,
    orgId: call.orgId,
    facilityId: call.facilityId,
    patientId: call.patientId!,
    callId: call.id,
    level: call.risk === "red" ? "red" : "amber",
    trigger: call.risk === "red" ? "New chest pain post cardiac discharge (R1)" : "Missed dose + new symptom (R7)",
    detail: call.summary,
    raisedAt: call.startedAt,
    assignedTo: assignable.length ? pick(assignable).id : "usr_dc_nurse",
    status,
    acknowledgedAt: status !== "open" ? isoMinutesAgo(int(10, 400)) : undefined,
    acknowledgedBy: status !== "open" ? "usr_dc_nurse" : undefined,
    resolvedAt: status === "resolved" ? isoMinutesAgo(int(5, 300)) : undefined,
    resolutionNote: status === "resolved" ? pick(["Patient reviewed by on-call, advised ECG at nearest centre. Stable.", "Tele-consult done; dose reinforced, no change needed.", "Called back, symptoms settled. Routine follow-up continues.", "Admitted for observation, family informed."]) : undefined,
    slaMinutes: call.risk === "red" ? 15 : 240,
  });
}

export const tasks: Task[] = [];
resetSeed();
let tCount = 0;
for (const org of organizations) {
  const orgPatients = patients.filter((p) => p.orgId === org.id);
  const count = org.id === "org_democare" ? 34 : 14;
  for (let i = 0; i < count; i++) {
    const pat = pick(orgPatients);
    const queue = pick<Task["queue"]>(["unreachable", "callback", "medication", "appointment", "review", "review", "critical"]);
    tCount++;
    tasks.push({
      id: `task_${String(tCount).padStart(3, "0")}`,
      orgId: org.id,
      patientId: pat.id,
      queue,
      title: {
        unreachable: "Patient unreachable after 3 attempts",
        callback: "Patient requested doctor callback",
        medication: "Medication question needs clinician",
        appointment: "Appointment change requested on call",
        review: "Patient-reported update needs review",
        critical: "Critical escalation awaiting acknowledgement",
      }[queue],
      detail: {
        unreachable: "Three attempts across two days, all unanswered inside the consent window. Try alternate contact or WhatsApp.",
        callback: "Patient asked to speak to the treating doctor about their report.",
        medication: "Asked whether the evening dose can be shifted; AI did not advise, routed to clinician.",
        appointment: "Requested to move the appointment to next Saturday morning.",
        review: "Structured follow-up captured with one amber signal. Needs clinician sign-off.",
        critical: "Red flag raised on the follow-up call. SLA clock running.",
      }[queue],
      assignedTo: (() => {
        const pool = users.filter((u) => u.orgId === org.id && (u.role === "nurse" || u.role === "doctor"));
        return rnd() > 0.35 && pool.length ? pick(pool).id : null;
      })(),
      priority: queue === "critical" ? "high" : queue === "review" ? "normal" : pick<Task["priority"]>(["low", "normal", "normal"]),
      createdAt: isoMinutesAgo(int(20, 4000)),
      dueAt: isoMinutesAgo(-int(30, 2000)),
      status: pick<Task["status"]>(["open", "open", "open", "in_progress", "done"]),
    });
  }
}

/* ------------------------------------------------------------------ */
/* campaigns, agents, protocols                                        */
/* ------------------------------------------------------------------ */
export const campaigns: Campaign[] = [
  { id: "camp_001", orgId: "org_democare", name: "Cardiac post-discharge — Day 3", agentType: "care", protocolId: "prot_card_pd", departmentId: "dept_fac_dc_main_card", cohortDescription: "Discharged cardiology patients, day 3 after discharge", totalPatients: 184, called: 184, connected: 151, completed: 143, escalated: 11, languages: ["mr", "hi", "en"], window: "10:00 – 18:00", retryPolicy: "3 attempts, 4h apart", status: "running", startDate: iso(-28) },
  { id: "camp_002", orgId: "org_democare", name: "Ortho post-op physiotherapy adherence", agentType: "care", protocolId: "prot_orth_po", departmentId: "dept_fac_dc_main_orth", cohortDescription: "Knee/hip replacement, week 2 post-op", totalPatients: 96, called: 88, connected: 71, completed: 66, escalated: 3, languages: ["mr", "hi"], window: "11:00 – 17:00", retryPolicy: "2 attempts, 6h apart", status: "running", startDate: iso(-21) },
  { id: "camp_003", orgId: "org_democare", name: "Appointment reminder — next 48h", agentType: "receptionist", protocolId: "prot_reminder", departmentId: "dept_fac_dc_main_gmed", cohortDescription: "All confirmed appointments in the next 48 hours", totalPatients: 312, called: 312, connected: 279, completed: 271, escalated: 0, languages: ["mr", "hi", "en"], window: "09:00 – 20:00", retryPolicy: "2 attempts", status: "running", startDate: iso(-60) },
  { id: "camp_004", orgId: "org_democare", name: "Antenatal 32-week check-in", agentType: "care", protocolId: "prot_obgy", departmentId: "dept_fac_dc_main_obgy", cohortDescription: "Antenatal patients at 32 weeks gestation", totalPatients: 54, called: 0, connected: 0, completed: 0, escalated: 0, languages: ["mr", "hi"], window: "10:00 – 16:00", retryPolicy: "3 attempts", status: "scheduled", startDate: iso(3) },
  { id: "camp_005", orgId: "org_democare", name: "Chemotherapy tolerance — cycle 3", agentType: "care", protocolId: "prot_onco", departmentId: "dept_fac_dc_main_onco", cohortDescription: "Oncology patients 48h after cycle 3", totalPatients: 38, called: 38, connected: 33, completed: 30, escalated: 6, languages: ["mr", "en"], window: "10:00 – 15:00", retryPolicy: "3 attempts", status: "paused", startDate: iso(-14) },
  { id: "camp_006", orgId: "org_sahyadri", name: "Diabetes adherence pilot", agentType: "care", protocolId: "prot_gmed", departmentId: "dept_fac_sc_main_gmed", cohortDescription: "Type 2 diabetes patients on oral therapy", totalPatients: 120, called: 74, connected: 58, completed: 52, escalated: 4, languages: ["mr", "hi"], window: "10:00 – 18:00", retryPolicy: "3 attempts", status: "running", startDate: iso(-12) },
];

export const agents: Agent[] = [
  { id: "agent_org_democare_recep", orgId: "org_democare", name: "DemoCare Front Desk", type: "receptionist", departmentId: null, purpose: "Answer inbound calls, book/reschedule/cancel appointments, answer approved FAQs, transfer to humans.", languages: ["mr", "hi", "en", "hinglish"], identityVerification: "dob_name", capabilities: ["Check availability", "Book appointment", "Reschedule", "Cancel", "Answer FAQ", "Send confirmation", "Human transfer"], knowledgeScope: "Hospital FAQ v9 (timings, directions, departments, insurance desk, visiting hours)", protocolId: null, escalationTarget: "Front desk supervisor", humanTransferNumber: "+91 20 4000 1010", recordingPolicy: "consent", retentionDays: 90, maxTurns: 30, version: "v3.4", status: "published", voice: "Marathi — Aarohi (female, warm)", publishedAt: iso(-12, 15) },
  { id: "agent_org_democare_care", orgId: "org_democare", name: "DemoCare Care Follow-up", type: "care", departmentId: "dept_fac_dc_main_card", purpose: "Run hospital-approved post-discharge follow-up questionnaires, capture structured responses, escalate red flags.", languages: ["mr", "hi", "en"], identityVerification: "dob_name", capabilities: ["Verify identity", "Ask approved questions", "Capture adherence", "Record side effects", "Request appointment", "Escalate", "Human transfer"], knowledgeScope: "Cardiology discharge instruction set v3 only — no access to full clinical record", protocolId: "prot_card_pd", escalationTarget: "Cardiology on-call + care coordinator", humanTransferNumber: "+91 20 4000 1099", recordingPolicy: "consent", retentionDays: 180, maxTurns: 24, version: "v3.2", status: "published", voice: "Marathi — Aarohi (female, warm)", publishedAt: iso(-9, 11) },
  { id: "agent_org_democare_draft", orgId: "org_democare", name: "Oncology Symptom Check (draft)", type: "care", departmentId: "dept_fac_dc_main_onco", purpose: "Chemotherapy tolerance check 48h after each cycle.", languages: ["mr", "en"], identityVerification: "otp", capabilities: ["Verify identity", "Ask approved questions", "Escalate"], knowledgeScope: "Oncology chemo instruction set v1", protocolId: "prot_onco", escalationTarget: "Oncology day-care nurse", humanTransferNumber: "+91 20 4000 1080", recordingPolicy: "always", retentionDays: 365, maxTurns: 20, version: "v0.9", status: "draft", voice: "Hindi — Kavya (female, calm)", publishedAt: null },
  { id: "agent_org_sahyadri_recep", orgId: "org_sahyadri", name: "Sahyadri Front Desk", type: "receptionist", departmentId: null, purpose: "Inbound booking and FAQs for the pilot facility.", languages: ["mr", "hi", "en"], identityVerification: "dob_name", capabilities: ["Check availability", "Book appointment", "Reschedule", "Answer FAQ", "Human transfer"], knowledgeScope: "Sahyadri FAQ v2", protocolId: null, escalationTarget: "Reception supervisor", humanTransferNumber: "+91 253 660 1010", recordingPolicy: "consent", retentionDays: 60, maxTurns: 25, version: "v1.1", status: "published", voice: "Marathi — Aarohi (female, warm)", publishedAt: iso(-30, 14) },
  { id: "agent_org_sahyadri_care", orgId: "org_sahyadri", name: "Sahyadri Diabetes Follow-up", type: "care", departmentId: "dept_fac_sc_main_gmed", purpose: "Adherence and symptom check for the diabetes pilot cohort.", languages: ["mr", "hi"], identityVerification: "dob_name", capabilities: ["Verify identity", "Ask approved questions", "Capture adherence", "Escalate"], knowledgeScope: "Diabetes counselling sheet v1", protocolId: "prot_gmed", escalationTarget: "Diabetes educator", humanTransferNumber: "+91 253 660 1050", recordingPolicy: "consent", retentionDays: 90, maxTurns: 20, version: "v1.0", status: "published", voice: "Marathi — Aarohi (female, warm)", publishedAt: iso(-11, 12) },
];

export const protocols: Protocol[] = [
  {
    id: "prot_card_pd", orgId: "org_democare", name: "Cardiac post-discharge follow-up", departmentId: "dept_fac_dc_main_card",
    version: "CARD-PD-v3.2", status: "approved", approvedBy: "Dr. Aniket Deshmukh (HOD Cardiology)", approvedAt: iso(-30, 16),
    questions: [
      { id: "q1", text: { mr: "डिस्चार्जनंतर तुमची तब्येत कशी आहे?", hi: "डिस्चार्ज के बाद आपकी तबियत कैसी है?", en: "How has your health been since discharge?", hinglish: "Discharge ke baad tabiyat kaisi hai?" }, answerType: "choice", choices: ["Improving", "Same", "Worse"], amberIf: "Same", redIf: "Worse" },
      { id: "q2", text: { mr: "छातीत दुखणं किंवा जडपणा जाणवला का?", hi: "क्या सीने में दर्द या भारीपन महसूस हुआ?", en: "Any chest pain or heaviness?", hinglish: "Chest pain ya heaviness hui?" }, answerType: "yesno", redIf: "Yes" },
      { id: "q3", text: { mr: "श्वास घेण्यास त्रास होतो का?", hi: "क्या साँस लेने में तकलीफ़ है?", en: "Any breathlessness?", hinglish: "Saans lene mein takleef?" }, answerType: "yesno", redIf: "Yes" },
      { id: "q4", text: { mr: "पाय किंवा घोट्याला सूज आहे का?", hi: "क्या पैरों में सूजन है?", en: "Any swelling in legs or ankles?", hinglish: "Pairon mein sujan hai?" }, answerType: "yesno", amberIf: "Yes" },
      { id: "q5", text: { mr: "सर्व औषधं वेळेवर घेतली का?", hi: "क्या सभी दवाइयाँ समय पर लीं?", en: "Have you taken all medicines as prescribed?", hinglish: "Sab medicines time pe li?" }, answerType: "yesno", amberIf: "No" },
      { id: "q6", text: { mr: "कोणताही नवीन त्रास जाणवतो का?", hi: "कोई नई शिकायत?", en: "Any new complaint?", hinglish: "Koi nayi complaint?" }, answerType: "text" },
      { id: "q7", text: { mr: "आमच्या सेवेला पाचपैकी किती गुण द्याल?", hi: "हमारी सेवा को पाँच में से कितने अंक?", en: "How would you rate our service out of five?", hinglish: "Service ko 5 mein se kitne?" }, answerType: "scale" },
    ],
    redFlags: ["New or worsening chest pain", "Breathlessness at rest", "Syncope / fainting", "Reported health 'Worse'", "Systolic BP < 90 reported by patient"],
    escalationTarget: "Cardiology on-call (+91 20 4000 1099) and assigned care coordinator",
    slaMinutes: 15,
  },
  {
    id: "prot_orth_po", orgId: "org_democare", name: "Orthopaedic post-op recovery", departmentId: "dept_fac_dc_main_orth",
    version: "ORTH-PO-v2.1", status: "approved", approvedBy: "Dr. Rahul Joshi (HOD Orthopaedics)", approvedAt: iso(-52, 12),
    questions: [
      { id: "q1", text: { mr: "जखमेतून स्त्राव किंवा लालसरपणा आहे का?", hi: "क्या घाव से रिसाव या लालिमा है?", en: "Any discharge or redness at the wound?", hinglish: "Wound se discharge ya redness?" }, answerType: "yesno", redIf: "Yes" },
      { id: "q2", text: { mr: "ताप आला होता का?", hi: "क्या बुखार आया?", en: "Any fever?", hinglish: "Bukhar aaya?" }, answerType: "yesno", redIf: "Yes" },
      { id: "q3", text: { mr: "वेदना दहापैकी किती?", hi: "दर्द दस में से कितना?", en: "Pain score out of ten?", hinglish: "Pain 10 mein se kitna?" }, answerType: "scale", amberIf: ">6" },
      { id: "q4", text: { mr: "फिजिओथेरपी व्यायाम करत आहात का?", hi: "क्या फिजियोथेरेपी कर रहे हैं?", en: "Are you doing the physiotherapy exercises?", hinglish: "Physio exercises kar rahe hain?" }, answerType: "yesno", amberIf: "No" },
    ],
    redFlags: ["Wound discharge or spreading redness", "Fever above 38°C", "Calf pain or swelling (DVT suspicion)", "Sudden inability to bear weight"],
    escalationTarget: "Orthopaedic registrar on duty",
    slaMinutes: 60,
  },
  {
    id: "prot_gmed", orgId: "org_sahyadri", name: "Diabetes adherence check", departmentId: "dept_fac_sc_main_gmed",
    version: "GMED-DM-v1.0", status: "approved", approvedBy: "Dr. Kavita Sathe", approvedAt: iso(-14, 11),
    questions: [
      { id: "q1", text: { mr: "साखरेची तपासणी केली का? किती आली?", hi: "शुगर जाँची? कितनी आई?", en: "Have you checked your sugar? What was the reading?", hinglish: "Sugar check ki? Kitni aayi?" }, answerType: "text", redIf: ">400 or <70" },
      { id: "q2", text: { mr: "औषधं नियमित घेता का?", hi: "दवाइयाँ नियमित लेते हैं?", en: "Are you taking medicines regularly?", hinglish: "Medicines regular le rahe hain?" }, answerType: "yesno", amberIf: "No" },
      { id: "q3", text: { mr: "चक्कर किंवा घाम येण्याचा त्रास?", hi: "चक्कर या पसीना आना?", en: "Any dizziness or sweating episodes?", hinglish: "Chakkar ya pasina?" }, answerType: "yesno", redIf: "Yes" },
    ],
    redFlags: ["Blood sugar above 400 mg/dL", "Blood sugar below 70 mg/dL", "Hypoglycaemia symptoms", "Vomiting with inability to keep fluids"],
    escalationTarget: "Diabetes educator, then treating physician",
    slaMinutes: 120,
  },
  {
    id: "prot_onco", orgId: "org_democare", name: "Chemotherapy tolerance check", departmentId: "dept_fac_dc_main_onco",
    version: "ONCO-CT-v0.9", status: "draft", approvedBy: null, approvedAt: null,
    questions: [
      { id: "q1", text: { mr: "ताप आहे का?", hi: "बुखार है?", en: "Do you have fever?", hinglish: "Bukhar hai?" }, answerType: "yesno", redIf: "Yes" },
      { id: "q2", text: { mr: "उलट्या किती वेळा झाल्या?", hi: "कितनी बार उल्टी हुई?", en: "How many episodes of vomiting?", hinglish: "Kitni baar vomiting?" }, answerType: "scale", amberIf: ">3" },
      { id: "q3", text: { mr: "तोंडात फोड आहेत का?", hi: "मुँह में छाले?", en: "Any mouth ulcers?", hinglish: "Muh mein chhale?" }, answerType: "yesno", amberIf: "Yes" },
    ],
    redFlags: ["Fever above 38°C (neutropenic sepsis risk)", "More than 5 vomiting episodes", "Bleeding from any site"],
    escalationTarget: "Oncology day-care nurse, then consultant",
    slaMinutes: 30,
  },
];

/* ------------------------------------------------------------------ */
/* IPD — wards and beds                                                */
/* ------------------------------------------------------------------ */
export const wards: Ward[] = [
  { id: "ward_dc_icu", orgId: "org_democare", facilityId: "fac_dc_main", name: "Cardiac ICU", type: "icu", floor: 3 },
  { id: "ward_dc_hdu", orgId: "org_democare", facilityId: "fac_dc_main", name: "HDU — East", type: "hdu", floor: 3 },
  { id: "ward_dc_gen_a", orgId: "org_democare", facilityId: "fac_dc_main", name: "General Ward A", type: "general", floor: 2 },
  { id: "ward_dc_priv", orgId: "org_democare", facilityId: "fac_dc_main", name: "Private Rooms", type: "private", floor: 4 },
  { id: "ward_dc_mat", orgId: "org_democare", facilityId: "fac_dc_main", name: "Maternity", type: "maternity", floor: 5 },
  { id: "ward_dc_ped", orgId: "org_democare", facilityId: "fac_dc_main", name: "Paediatric Ward", type: "pediatric", floor: 5 },
  { id: "ward_sc_gen", orgId: "org_sahyadri", facilityId: "fac_sc_main", name: "General Ward", type: "general", floor: 1 },
  { id: "ward_sc_icu", orgId: "org_sahyadri", facilityId: "fac_sc_main", name: "ICU", type: "icu", floor: 2 },
];

export const beds: Bed[] = [];
resetSeed();
for (const ward of wards) {
  const n = ward.type === "icu" ? 10 : ward.type === "hdu" ? 8 : ward.type === "private" ? 14 : 20;
  const ipdPatients = patients.filter((p) => p.orgId === ward.orgId && p.status === "ipd");
  let ipdIdx = wards.indexOf(ward) * 3;
  for (let i = 1; i <= n; i++) {
    const r = rnd();
    const status: Bed["status"] = r > 0.42 ? "occupied" : r > 0.34 ? "cleaning" : r > 0.3 ? "maintenance" : r > 0.26 ? "reserved" : "available";
    const pat = status === "occupied" && ipdPatients.length ? ipdPatients[ipdIdx++ % ipdPatients.length] : null;
    beds.push({
      id: `bed_${ward.id}_${i}`,
      orgId: ward.orgId,
      wardId: ward.id,
      number: `${ward.name.split(" ")[0].slice(0, 3).toUpperCase()}-${String(i).padStart(2, "0")}`,
      status,
      patientId: pat ? pat.id : null,
      admittedAt: pat ? iso(-int(1, 7), int(6, 22)) : undefined,
      dailyRate: ward.type === "icu" ? 18000 : ward.type === "hdu" ? 11000 : ward.type === "private" ? 7500 : 3200,
    });
  }
}

/* ------------------------------------------------------------------ */
/* OT schedule                                                         */
/* ------------------------------------------------------------------ */
const PROCEDURES = [
  "Total knee replacement", "CABG", "Laparoscopic cholecystectomy", "LSCS", "Hernia repair (TAPP)",
  "PTCA with stent", "Hip arthroplasty", "Appendicectomy", "TURP", "Cataract phaco", "Arthroscopy — ACL",
];
export const otSlots: OTSlot[] = [];
resetSeed();
let otCount = 0;
for (const org of [organizations[0], organizations[1]]) {
  const theatres = org.id === "org_democare" ? ["OT-1 Cardiac", "OT-2 Ortho", "OT-3 General", "OT-4 Obstetric"] : ["OT-1", "OT-2"];
  const orgPatients = patients.filter((p) => p.orgId === org.id);
  const orgProviders = providers.filter((p) => p.orgId === org.id);
  for (let day = -2; day <= 4; day++) {
    for (const theatre of theatres) {
      let hour = 8;
      const slots = int(2, 4);
      for (let s = 0; s < slots; s++) {
        const dur = pick([60, 90, 120, 150, 180]);
        otCount++;
        otSlots.push({
          id: `ot_${String(otCount).padStart(4, "0")}`,
          orgId: org.id,
          facilityId: facilities.find((f) => f.orgId === org.id && f.isPrimary)!.id,
          theatre,
          start: iso(day, hour, 0),
          durationMinutes: dur,
          procedure: pick(PROCEDURES),
          patientId: pick(orgPatients).id,
          surgeonId: pick(orgProviders).id,
          anaesthetist: pick(["Dr. S. Kelkar", "Dr. M. Fernandes", "Dr. A. Bhat", "Dr. P. Raut"]),
          status: day < 0 ? "completed" : day === 0 && hour < NOW.getHours() ? "in_progress" : rnd() > 0.93 ? "cancelled" : "scheduled",
          checklistComplete: day <= 0 || rnd() > 0.4,
          priority: rnd() > 0.87 ? "emergency" : "elective",
        });
        hour += Math.ceil(dur / 60) + 1;
        if (hour > 19) break;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* pharmacy                                                            */
/* ------------------------------------------------------------------ */
const DRUG_DEFS = [
  ["Ecosprin", "Tablet", "75 mg", 3.2, false], ["Atorvastatin", "Tablet", "40 mg", 8.5, false],
  ["Metoprolol", "Tablet", "25 mg", 6.1, false], ["Metformin", "Tablet", "500 mg", 2.4, false],
  ["Telmisartan", "Tablet", "40 mg", 9.8, false], ["Pantoprazole", "Tablet", "40 mg", 5.4, false],
  ["Ondansetron", "Tablet", "4 mg", 7.2, false], ["Aceclofenac", "Tablet", "100 mg", 4.9, false],
  ["Amoxicillin + Clav", "Tablet", "625 mg", 18.5, true], ["Meropenem", "Injection", "1 g", 640, true],
  ["Insulin Glargine", "Pen", "100 IU/ml", 890, true], ["Enoxaparin", "Injection", "40 mg", 385, true],
  ["Budesonide MDI", "Inhaler", "200 mcg", 465, false], ["Ferrous ascorbate", "Tablet", "100 mg", 6.8, false],
  ["Calcium + D3", "Tablet", "500 mg", 4.2, false], ["Tramadol", "Injection", "50 mg", 22, true],
  ["Normal Saline", "IV Fluid", "500 ml", 48, false], ["Paracetamol Syrup", "Syrup", "250 mg/5ml", 62, false],
  ["Clopidogrel", "Tablet", "75 mg", 11.4, false], ["Furosemide", "Tablet", "40 mg", 3.6, false],
];
export const drugs: Drug[] = [];
resetSeed();
let dCount = 0;
for (const org of [organizations[0], organizations[1]]) {
  for (const [name, form, strength, price, sch] of DRUG_DEFS) {
    dCount++;
    const reorder = int(40, 150);
    drugs.push({
      id: `drug_${String(dCount).padStart(3, "0")}`,
      orgId: org.id,
      name: name as string,
      form: form as string,
      strength: strength as string,
      batch: `B${int(10000, 99999)}`,
      expiry: iso(int(-20, 640), 0),
      stock: rnd() > 0.78 ? int(0, reorder - 5) : int(reorder, reorder * 8),
      reorderLevel: reorder,
      unitPrice: price as number,
      supplier: pick(["MedSupply India", "Pharma Distributors Pune", "Nashik Medico", "Apex Healthcare"]),
      scheduleH: sch as boolean,
    });
  }
}

/* ------------------------------------------------------------------ */
/* labs                                                                */
/* ------------------------------------------------------------------ */
const PANELS: Record<string, { name: string; unit: string; range: string; normal: () => string }[]> = {
  "Complete Blood Count": [
    { name: "Haemoglobin", unit: "g/dL", range: "13.0–17.0", normal: () => (10 + rnd() * 7).toFixed(1) },
    { name: "WBC", unit: "/µL", range: "4000–11000", normal: () => String(int(3200, 14800)) },
    { name: "Platelets", unit: "/µL", range: "150000–410000", normal: () => String(int(110000, 420000)) },
  ],
  "Lipid Profile": [
    { name: "Total cholesterol", unit: "mg/dL", range: "< 200", normal: () => String(int(140, 265)) },
    { name: "LDL", unit: "mg/dL", range: "< 100", normal: () => String(int(60, 180)) },
    { name: "HDL", unit: "mg/dL", range: "> 40", normal: () => String(int(28, 68)) },
    { name: "Triglycerides", unit: "mg/dL", range: "< 150", normal: () => String(int(80, 320)) },
  ],
  "Renal Function": [
    { name: "Creatinine", unit: "mg/dL", range: "0.7–1.3", normal: () => (0.6 + rnd() * 2.4).toFixed(2) },
    { name: "Urea", unit: "mg/dL", range: "15–40", normal: () => String(int(12, 74)) },
    { name: "Potassium", unit: "mmol/L", range: "3.5–5.1", normal: () => (3.1 + rnd() * 2.6).toFixed(1) },
  ],
  "HbA1c": [{ name: "HbA1c", unit: "%", range: "< 5.7", normal: () => (5.1 + rnd() * 5).toFixed(1) }],
  "Cardiac Markers": [
    { name: "Troponin I", unit: "ng/mL", range: "< 0.04", normal: () => (rnd() * 0.9).toFixed(3) },
    { name: "CK-MB", unit: "ng/mL", range: "< 5.0", normal: () => (1 + rnd() * 12).toFixed(1) },
  ],
  "Liver Function": [
    { name: "SGPT (ALT)", unit: "U/L", range: "< 45", normal: () => String(int(14, 120)) },
    { name: "Bilirubin total", unit: "mg/dL", range: "0.2–1.2", normal: () => (0.2 + rnd() * 2.4).toFixed(2) },
  ],
};

export const labOrders: LabOrder[] = [];
resetSeed();
let lCount = 0;
for (const org of [organizations[0], organizations[1]]) {
  const orgPatients = patients.filter((p) => p.orgId === org.id);
  const count = org.id === "org_democare" ? 40 : 16;
  for (let i = 0; i < count; i++) {
    const pat = pick(orgPatients);
    const panelName = pick(Object.keys(PANELS));
    const status = pick<LabOrder["status"]>(["ordered", "collected", "processing", "resulted", "resulted", "verified"]);
    const resulted = status === "resulted" || status === "verified";
    const tests = PANELS[panelName].map((t) => {
      const value = t.normal();
      const num = parseFloat(value);
      const abnormal = t.range.startsWith("<") ? num > parseFloat(t.range.replace("<", "")) : t.range.startsWith(">") ? num < parseFloat(t.range.replace(">", "")) : (() => {
        const [lo, hi] = t.range.split("–").map(parseFloat);
        return num < lo || num > hi;
      })();
      return { name: t.name, value: resulted ? value : undefined, unit: t.unit, range: t.range, abnormal: resulted ? abnormal : false };
    });
    lCount++;
    labOrders.push({
      id: `lab_${String(lCount).padStart(4, "0")}`,
      orgId: org.id,
      patientId: pat.id,
      providerId: pat.providerId,
      panel: panelName,
      tests,
      orderedAt: isoMinutesAgo(int(30, 6000)),
      status,
      priority: pick<LabOrder["priority"]>(["routine", "routine", "routine", "urgent", "stat"]),
      criticalFlag: resulted && tests.some((t) => t.abnormal) && rnd() > 0.6,
      resultedAt: resulted ? isoMinutesAgo(int(5, 400)) : undefined,
    });
  }
}

/* ------------------------------------------------------------------ */
/* emergency                                                           */
/* ------------------------------------------------------------------ */
export const emergencyCases: EmergencyCase[] = [];
resetSeed();
const COMPLAINTS: [string, 1 | 2 | 3 | 4 | 5][] = [
  ["Chest pain, diaphoresis — ?ACS", 1], ["RTA polytrauma", 1], ["Breathlessness, SpO2 88%", 2],
  ["Seizure, first episode", 2], ["High-grade fever with rigors", 3], ["Abdominal pain, vomiting", 3],
  ["Fall at home, wrist injury", 4], ["Dog bite — needs ARV", 4], ["Fever and cough 3 days", 5],
  ["Dressing change requested", 5], ["Acute stroke — FAST positive", 1], ["Hypoglycaemia, drowsy", 2],
];
for (let i = 0; i < 14; i++) {
  const [complaint, triage] = COMPLAINTS[i % COMPLAINTS.length];
  const pat = rnd() > 0.5 ? pick(patients.filter((p) => p.orgId === "org_democare")) : null;
  emergencyCases.push({
    id: `er_${String(i + 1).padStart(3, "0")}`,
    orgId: "org_democare",
    facilityId: "fac_dc_main",
    patientName: pat ? pat.name : `${pick([...FIRST_M, ...FIRST_F])} ${pick(LAST)}`,
    patientId: pat ? pat.id : null,
    age: int(8, 88),
    complaint,
    triage,
    arrivalMode: triage <= 2 ? pick(["ambulance", "ambulance", "referral"]) : pick(["walk_in", "walk_in", "ambulance"]),
    arrivedAt: isoMinutesAgo(int(3, 300)),
    vitals: { bp: `${int(80, 170)}/${int(50, 100)}`, pulse: int(52, 138), spo2: int(84, 99), temp: parseFloat((36.2 + rnd() * 3).toFixed(1)) },
    assignedTo: pick(["Dr. Vikram Shinde", "Dr. Neha Gupta", "Dr. Imran Shaikh", "Unassigned"]),
    status: i < 5 ? "waiting" : i < 9 ? "in_treatment" : pick<EmergencyCase["status"]>(["admitted", "discharged", "referred"]),
    ambulanceEta: i < 2 ? int(3, 18) : undefined,
  });
}

/* ------------------------------------------------------------------ */
/* billing                                                             */
/* ------------------------------------------------------------------ */
export const invoices: Invoice[] = [];
resetSeed();
let invCount = 0;
for (const org of [organizations[0], organizations[1]]) {
  const orgPatients = patients.filter((p) => p.orgId === org.id);
  const count = org.id === "org_democare" ? 38 : 16;
  for (let i = 0; i < count; i++) {
    const pat = pick(orgPatients);
    const ipd = pat.status === "ipd" || rnd() > 0.7;
    const lines = ipd
      ? [
          { description: "Room charges (ICU)", qty: int(1, 5), rate: 18000, category: "room" as const },
          { description: "Consultant visits", qty: int(2, 8), rate: 1200, category: "consultation" as const },
          { description: "Pharmacy & consumables", qty: 1, rate: int(8000, 60000), category: "pharmacy" as const },
          { description: "Investigations", qty: 1, rate: int(3000, 22000), category: "lab" as const },
        ]
      : [
          { description: "OPD consultation", qty: 1, rate: pick([600, 800, 1000, 1500]), category: "consultation" as const },
          { description: "Investigations", qty: 1, rate: int(400, 4500), category: "lab" as const },
        ];
    const gross = lines.reduce((s, l) => s + l.qty * l.rate, 0);
    const discount = rnd() > 0.75 ? Math.round(gross * 0.05) : 0;
    const status = pick<Invoice["status"]>(["paid", "paid", "part_paid", "issued", "overdue", "insurance_pending"]);
    const total = Math.round((gross - discount) * 1.0);
    invCount++;
    invoices.push({
      id: `inv_${String(invCount).padStart(4, "0")}`,
      orgId: org.id,
      patientId: pat.id,
      number: `${org.logoInitials}/26-27/${String(4000 + invCount)}`,
      issuedAt: iso(-int(0, 40), int(9, 19)),
      lines,
      discount,
      taxRate: 0,
      paid: status === "paid" ? total : status === "part_paid" ? Math.round(total * 0.4) : 0,
      status,
      payer: pick<Invoice["payer"]>(["self", "self", "insurance", "corporate", "scheme"]),
      insurer: rnd() > 0.6 ? pick(["Star Health", "HDFC Ergo", "New India Assurance", "MJPJAY scheme", "Bajaj Allianz"]) : undefined,
      paymentMode: status === "paid" || status === "part_paid" ? pick(["upi", "card", "cash", "netbanking"]) : undefined,
    });
  }
}

/* ------------------------------------------------------------------ */
/* messaging threads                                                   */
/* ------------------------------------------------------------------ */
const MSG_SCRIPTS: { body: string; dir: "in" | "out"; ai: boolean }[][] = [
  [
    { body: "Namaste! Your appointment with Dr. Aniket Deshmukh is confirmed for Thursday 11:15 am at DemoCare Kothrud. Reply 1 to confirm, 2 to reschedule.", dir: "out", ai: true },
    { body: "1", dir: "in", ai: false },
    { body: "Confirmed. Please carry your previous reports and arrive 15 minutes early. — DemoCare", dir: "out", ai: true },
  ],
  [
    { body: "तुमची डिस्चार्ज नंतरची तपासणी उद्या आहे. येऊ शकाल का?", dir: "out", ai: true },
    { body: "मला त्या दिवशी जमणार नाही, पुढच्या आठवड्यात करता येईल का?", dir: "in", ai: false },
    { body: "नक्की. पुढील शनिवार सकाळी ११:०० ही वेळ उपलब्ध आहे. चालेल का?", dir: "out", ai: true },
    { body: "हो चालेल, धन्यवाद", dir: "in", ai: false },
  ],
  [
    { body: "Your lab report for Lipid Profile is ready. View securely: hospital-ai.os/r/48213 (valid 48 hours)", dir: "out", ai: true },
    { body: "My cholesterol is high, should I increase the medicine?", dir: "in", ai: false },
    { body: "I cannot advise on dosage. I have forwarded your question to Dr. Deshmukh's team and a clinician will call you back today.", dir: "out", ai: true },
    { body: "Hello, this is Rupali from Cardiology. Dr. Deshmukh has reviewed your report — please continue the same dose and come for review on Friday.", dir: "out", ai: false },
  ],
  [
    { body: "आपकी दवाइयाँ फार्मेसी में तैयार हैं। आज शाम 7 बजे तक ले जा सकते हैं।", dir: "out", ai: true },
    { body: "ठीक है", dir: "in", ai: false },
  ],
  [
    { body: "Reminder: your bill DC/26-27/4032 of ₹18,450 is pending. Pay securely: pay.hospital-ai.os/DC4032", dir: "out", ai: true },
    { body: "Paid just now via UPI", dir: "in", ai: false },
    { body: "Payment of ₹18,450 received. Receipt sent to your registered email. Thank you.", dir: "out", ai: true },
  ],
];

export const threads: Thread[] = [];
resetSeed();
let thCount = 0;
for (const org of [organizations[0], organizations[1]]) {
  const orgPatients = patients.filter((p) => p.orgId === org.id && p.consent.whatsapp);
  const count = org.id === "org_democare" ? 16 : 7;
  for (let i = 0; i < count; i++) {
    const pat = orgPatients[i % orgPatients.length];
    const script = MSG_SCRIPTS[i % MSG_SCRIPTS.length];
    const base = int(30, 3000);
    thCount++;
    const msgs = script.map((m, j) => ({
      id: `msg_${thCount}_${j}`,
      orgId: org.id,
      patientId: pat.id,
      channel: "whatsapp" as const,
      direction: m.dir,
      body: m.body,
      at: isoMinutesAgo(base - j * 4),
      status: m.dir === "out" ? ("read" as const) : ("received" as const),
      handledBy: m.ai ? ("ai" as const) : ("staff" as const),
    }));
    threads.push({
      id: `thr_${String(thCount).padStart(3, "0")}`,
      orgId: org.id,
      patientId: pat.id,
      channel: "whatsapp",
      lastAt: msgs[msgs.length - 1].at,
      unread: i < 4 ? int(1, 3) : 0,
      assignedTo: i % 3 === 0 ? "usr_dc_nurse" : null,
      aiHandling: i % 4 !== 0,
      messages: msgs,
    });
  }
}
threads.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));

/* ------------------------------------------------------------------ */
/* audit, integrations, telephony, imports, incidents                  */
/* ------------------------------------------------------------------ */
const AUDIT_ACTIONS: [string, string, AuditLog["severity"]][] = [
  ["agent.published", "Agent DemoCare Care Follow-up v3.2", "warning"],
  ["protocol.approved", "CARD-PD-v3.2 by HOD Cardiology", "warning"],
  ["user.created", "Vaishali Pandit (nurse, invited)", "info"],
  ["user.suspended", "Omkar Bhide (receptionist)", "warning"],
  ["export.generated", "Follow-up report — 1,204 rows (role-filtered)", "warning"],
  ["export.downloaded", "Follow-up report — link expired after download", "info"],
  ["patient.clinical.viewed", "MRN DC100370 by Dr. Aniket Deshmukh", "info"],
  ["call.recording.played", "call_0012 by Rupali Tambe", "warning"],
  ["escalation.acknowledged", "esc_001 acknowledged in 6 min (SLA 15)", "info"],
  ["integration.sync", "HIS appointment sync — 482 records", "info"],
  ["login.mfa.success", "sunita.kale@democare.in", "info"],
  ["login.failed", "unknown@democare.in — 3 attempts, blocked", "critical"],
  ["retention.purge", "Recordings older than 180 days purged (312 files)", "info"],
  ["consent.withdrawn", "Patient DC100518 withdrew marketing consent", "warning"],
  ["tenant.access", "Super admin opened DemoCare workspace (justification logged)", "critical"],
  ["import.approved", "followups_sept.xlsx — 97 of 100 rows imported", "info"],
];
export const auditLogs: AuditLog[] = [];
resetSeed();
for (let i = 0; i < 60; i++) {
  const [action, target, severity] = AUDIT_ACTIONS[i % AUDIT_ACTIONS.length];
  /*
   * The actor must belong to a hospital.
   *
   * The platform account belongs to none, so picking it produced seeded audit
   * rows with a null org — rows that no per-hospital cleanup can find, and that
   * then collided on their fixed ids the next time the demo was seeded. An
   * audit entry in a hospital's demo data should belong to that hospital
   * anyway.
   */
  const actor = pick(users.filter((u) => u.role !== "patient" && u.orgId));
  auditLogs.push({
    id: `aud_${String(i + 1).padStart(4, "0")}`,
    orgId: actor.orgId,
    actor: actor.name,
    actorRole: actor.role,
    action,
    target,
    at: isoMinutesAgo(int(2, 9000)),
    ip: `10.${int(0, 40)}.${int(0, 255)}.${int(2, 250)}`,
    severity,
  });
}
auditLogs.sort((a, b) => (a.at < b.at ? 1 : -1));

export const integrations: Integration[] = [
  { id: "int_dc_his", orgId: "org_democare", name: "HIS — appointments & ADT", kind: "his", vendor: "Insta HMS", status: "live", lastSync: isoMinutesAgo(4), recordsSynced: 148392, direction: "bidirectional", endpoint: "https://his.democare.internal/api/v2" },
  { id: "int_dc_fhir", orgId: "org_democare", name: "FHIR R4 gateway", kind: "fhir", vendor: "HAPI FHIR", status: "live", lastSync: isoMinutesAgo(11), recordsSynced: 64210, direction: "bidirectional", endpoint: "https://fhir.democare.internal/fhir/R4" },
  { id: "int_dc_hl7", orgId: "org_democare", name: "HL7 v2 ADT feed", kind: "hl7", vendor: "Mirth Connect", status: "live", lastSync: isoMinutesAgo(2), recordsSynced: 39120, direction: "inbound", endpoint: "mllp://10.20.4.8:6661" },
  { id: "int_dc_lab", orgId: "org_democare", name: "LIS — pathology results", kind: "lab", vendor: "CrelioHealth", status: "live", lastSync: isoMinutesAgo(19), recordsSynced: 28844, direction: "inbound", endpoint: "https://lis.democare.internal/api" },
  { id: "int_dc_sso", orgId: "org_democare", name: "Hospital SSO", kind: "sso", vendor: "Azure Entra ID (SAML)", status: "live", lastSync: isoMinutesAgo(60), recordsSynced: 312, direction: "inbound", endpoint: "https://login.microsoftonline.com/..." },
  { id: "int_dc_abdm", orgId: "org_democare", name: "ABDM — ABHA linking", kind: "abdm", vendor: "NHA Sandbox", status: "sandbox", lastSync: iso(-3, 15), recordsSynced: 420, direction: "bidirectional", endpoint: "https://dev.abdm.gov.in/gateway" },
  { id: "int_dc_pay", orgId: "org_democare", name: "Payments", kind: "payment", vendor: "Razorpay", status: "live", lastSync: isoMinutesAgo(7), recordsSynced: 9821, direction: "bidirectional", endpoint: "https://api.razorpay.com/v1" },
  { id: "int_dc_hook", orgId: "org_democare", name: "Discharge webhook → follow-up", kind: "webhook", vendor: "Internal", status: "error", lastSync: isoMinutesAgo(190), recordsSynced: 1204, direction: "inbound", endpoint: "https://api.hospital-ai.os/hooks/discharge" },
  { id: "int_sc_his", orgId: "org_sahyadri", name: "HIS — appointments", kind: "his", vendor: "eHospital", status: "sandbox", lastSync: iso(-1, 18), recordsSynced: 2140, direction: "inbound", endpoint: "https://his.sahyadricity.in/api" },
  { id: "int_sc_sso", orgId: "org_sahyadri", name: "Hospital SSO", kind: "sso", vendor: "Google Workspace (OIDC)", status: "not_configured", lastSync: null, recordsSynced: 0, direction: "inbound", endpoint: "—" },
];

export const telephony: TelephonyConfig[] = [
  { orgId: "org_democare", provider: "Exotel + SIP trunk (Airtel)", aiNumber: "+91 20 4000 1099", fallbackNumber: "+91 20 4000 1000", transferDestinations: [ { label: "Cardiology on-call", number: "+91 20 4000 1099", hours: "24×7" }, { label: "Front desk supervisor", number: "+91 20 4000 1010", hours: "08:00–21:00" }, { label: "Emergency", number: "+91 20 4000 1108", hours: "24×7" } ], concurrentChannels: 60, sipTrunk: "sip:democare@trunk.exotel.in", status: "connected", recordingStorage: "Dedicated S3 bucket (ap-south-1), SSE-KMS, 180-day lifecycle" },
  { orgId: "org_sahyadri", provider: "Exotel (managed numbers)", aiNumber: "+91 253 660 1050", fallbackNumber: "+91 253 660 1000", transferDestinations: [{ label: "Reception supervisor", number: "+91 253 660 1010", hours: "09:00–20:00" }], concurrentChannels: 12, sipTrunk: "—", status: "connected", recordingStorage: "Shared encrypted store, 90-day lifecycle" },
];

export const importJobs: ImportJob[] = [
  { id: "imp_003", orgId: "org_democare", fileName: "cardiac_followups_week37.xlsx", uploadedBy: "Sunita Kale", uploadedAt: isoMinutesAgo(95), totalRows: 100, valid: 97, issues: [ { type: "Missing mobile", count: 2, sample: "Row 41 — Suresh Kadam" }, { type: "Duplicate", count: 1, sample: "Row 78 — matches MRN DC100518" } ], status: "preview" },
  { id: "imp_002", orgId: "org_democare", fileName: "discharge_list_sept.xlsx", uploadedBy: "Sunita Kale", uploadedAt: iso(-2, 11), totalRows: 248, valid: 244, issues: [ { type: "Unknown doctor", count: 3, sample: "Row 12 — 'Dr Patil' not mapped" }, { type: "Invalid date", count: 1, sample: "Row 190 — 31/09/2026" } ], status: "imported" },
  { id: "imp_001", orgId: "org_sahyadri", fileName: "diabetes_pilot_cohort.csv", uploadedBy: "Nitin Wagh", uploadedAt: iso(-12, 16), totalRows: 120, valid: 120, issues: [], status: "imported" },
];

export const incidents: Incident[] = [
  { id: "inc_001", orgId: "org_democare", title: "Discharge webhook returning 502 — follow-up plans delayed", severity: "sev2", openedAt: isoMinutesAgo(190), status: "open", component: "Integration gateway" },
  { id: "inc_002", orgId: "org_lifeline", title: "STT accuracy drop on Marathi code-mixed calls", severity: "sev3", openedAt: iso(-2, 14), status: "mitigated", component: "Speech provider" },
  { id: "inc_003", orgId: "org_lifeline", title: "Voice minutes at 91% of contracted pool", severity: "sev3", openedAt: iso(-1, 9), status: "open", component: "Commercial" },
];

/* daily analytics series (last 30 days) */
export interface DayPoint { date: string; calls: number; connected: number; completed: number; booked: number; escalations: number; noShow: number; minutes: number; }
export const dailySeries: Record<string, DayPoint[]> = {};
resetSeed();
for (const org of organizations) {
  const scale = org.id === "org_democare" ? 1 : org.id === "org_sahyadri" ? 0.3 : 2.4;
  const arr: DayPoint[] = [];
  for (let d = 29; d >= 0; d--) {
    const weekend = new Date(NOW.getTime() - d * DAY).getDay() % 6 === 0;
    const base = Math.round((weekend ? 130 : 260) * scale);
    const calls = base + int(-30, 45);
    const connected = Math.round(calls * (0.72 + rnd() * 0.12));
    const completed = Math.round(connected * (0.88 + rnd() * 0.08));
    arr.push({
      date: new Date(NOW.getTime() - d * DAY).toISOString().slice(0, 10),
      calls, connected, completed,
      booked: Math.round(calls * (0.16 + rnd() * 0.08)),
      escalations: Math.round(completed * (0.02 + rnd() * 0.03)),
      noShow: Math.round(calls * (0.04 + rnd() * 0.04)),
      minutes: Math.round(connected * (1.8 + rnd() * 1.4)),
    });
  }
  dailySeries[org.id] = arr;
}

export const KNOWLEDGE_BASE = [
  { q: "What are the OPD timings?", a: "OPD runs 09:00–20:00 Monday to Saturday and 09:00–13:00 on Sunday.", tags: ["timings"], approvedBy: "Admin", version: "v9" },
  { q: "Where is the hospital located?", a: "Paud Road, Kothrud, Pune 411038. Landmark: opposite Mhatre bridge.", tags: ["directions"], approvedBy: "Admin", version: "v9" },
  { q: "Do you accept insurance?", a: "Yes — cashless is available for empanelled insurers. The insurance desk is on the ground floor, 09:00–18:00.", tags: ["billing"], approvedBy: "Admin", version: "v9" },
  { q: "What are the visiting hours?", a: "General wards 17:00–19:00; ICU 11:00–11:30 and 17:00–17:30, one attendant at a time.", tags: ["ipd"], approvedBy: "Admin", version: "v9" },
  { q: "How do I get a copy of my report?", a: "Reports are sent on WhatsApp to the registered number, or can be collected from the records desk with ID proof.", tags: ["reports"], approvedBy: "Admin", version: "v9" },
  { q: "Is there an emergency ambulance?", a: "Yes, 24×7. Call +91 20 4000 1108 for ambulance dispatch.", tags: ["emergency"], approvedBy: "Admin", version: "v9" },
];
