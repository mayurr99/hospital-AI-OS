/**
 * Content for Mitra, the in-app guide.
 *
 * One entry per screen: what it is for, who uses it, how to work it, and — where
 * a screen does not yet do what its buttons imply — an honest note. The guide is
 * useless if it describes an intention rather than the build, so `status` is the
 * verified state of that screen today.
 */

export type GuideStatus = "working" | "partial" | "gap";

export interface GuideStep {
  /** The role that normally performs this step. */
  who: string;
  text: string;
  note?: string;
}

export interface GuideEntry {
  path: string;
  title: string;
  group: string;
  status: GuideStatus;
  /** One sentence: what this screen is for. */
  blurb: string;
  /** Who lives on this screen day to day. */
  roles: string[];
  steps: GuideStep[];
  /** Shown as a warning block — a real limitation, not a disclaimer. */
  gap?: string;
  /** A non-obvious thing worth knowing. */
  tip?: string;
  /** Ordering in the guided tour; omitted screens are browsable but not toured. */
  tour?: number;
}

export const GUIDE: GuideEntry[] = [
  /* ------------------------------------------------------------ overview */
  {
    path: "/dashboard",
    title: "Dashboard",
    group: "Overview",
    status: "working",
    blurb: "The shift view — what needs a person right now, above everything that merely happened.",
    roles: ["Everyone"],
    tour: 1,
    steps: [
      { who: "Anyone", text: "Read the tiles left to right: they are ordered by how urgently a human is needed, not by how interesting the number is." },
      { who: "Anyone", text: "Click any tile to jump to the list behind it." },
    ],
    tip: "What you see here is already filtered by your role. Reception and a doctor open the same URL and get different cards.",
  },
  {
    path: "/analytics",
    title: "Analytics & ROI",
    group: "Overview",
    status: "working",
    blurb: "Call outcomes, reach rate, escalation yield and the cost model behind them.",
    roles: ["Hospital admin", "Management"],
    steps: [
      { who: "Admin", text: "Change the assumptions in the ROI panel to your own numbers — the model is arithmetic on your inputs, not a claim." },
    ],
    tip: "Reach rate is the number to watch first. Published trials of post-discharge calling fail on reach far more often than on the script.",
  },

  /* --------------------------------------------------------------- voice */
  {
    path: "/live",
    title: "Live call console",
    group: "AI voice",
    status: "working",
    blurb: "Watch an AI call as it happens, and take the line whenever you want it.",
    roles: ["Nurse", "Care coordinator"],
    tour: 8,
    steps: [
      { who: "Nurse", text: "Pick a patient and an agent, then press Start AI call." },
      { who: "Nurse", text: "Follow the transcript — the original language on top, the English translation underneath." },
      { who: "Nurse", text: "Watch the protocol checklist tick off, and the tool calls the agent is allowed to make." },
      { who: "Nurse", text: "Press You're live to take over the conversation at any point." },
    ],
    tip: "Pick a patient marked (red) to watch the whole red-flag path: rule matched, questionnaire stopped, call transferred, escalation opened — in about thirty seconds.",
  },
  {
    path: "/receptionist",
    title: "AI receptionist",
    group: "AI voice",
    status: "working",
    blurb: "Inbound calls answered and booked against the real slot calendar.",
    roles: ["Reception", "Hospital admin"],
    steps: [
      { who: "Reception", text: "Review what the agent booked, rescheduled or could not handle." },
      { who: "Reception", text: "Anything outside the agent's allow-list arrives here as a task with a named owner." },
    ],
    tip: "The receptionist never answers a clinical question. That refusal is the licence to operate, not a missing feature.",
  },
  {
    path: "/campaigns",
    title: "Follow-up campaigns",
    group: "AI voice",
    status: "working",
    blurb: "Cohorts, calling windows, retry policy and language for outbound follow-up.",
    roles: ["Nurse", "Hospital admin"],
    steps: [
      { who: "Admin", text: "Define who is in the cohort and which published protocol runs." },
      { who: "Admin", text: "Set the calling window and the retry policy — this is what closes the reach gap." },
    ],
  },
  {
    path: "/calls",
    title: "Call history",
    group: "AI voice",
    status: "working",
    blurb: "Every conversation with duration, outcome, language, risk and the exact protocol version that ran.",
    roles: ["Everyone with call access"],
    steps: [{ who: "Anyone", text: "Open a call to read its transcript, structured answers and summary." }],
  },
  {
    path: "/recordings",
    title: "Recordings",
    group: "AI voice",
    status: "working",
    blurb: "Audio held in your own storage, playable only where recording consent was granted.",
    roles: ["Nurse", "Doctor", "Hospital admin"],
    steps: [
      { who: "Clinician", text: "Press play. Audio streams through the server — it is never linked directly from your bucket." },
    ],
    tip: "Every playback writes an audit event naming you. That is deliberate.",
  },

  /* ------------------------------------------------------------ clinical */
  {
    path: "/doctor-crm",
    title: "Doctor review queue",
    group: "Clinical",
    status: "working",
    blurb: "Exceptions only — the calls and results that need a doctor's eye, not a list of everything.",
    roles: ["Doctor"],
    steps: [
      { who: "Doctor", text: "Work top to bottom. The queue is ordered by risk, then by how long it has waited." },
    ],
  },
  {
    path: "/care-queue",
    title: "Care coordinator queue",
    group: "Clinical",
    status: "working",
    blurb: "Callbacks, unreachable patients, medication questions and reviews.",
    roles: ["Nurse", "Care coordinator"],
    steps: [{ who: "Nurse", text: "Claim a task, act on it, and close it with a note." }],
  },
  {
    path: "/escalations",
    title: "Escalations",
    group: "Clinical",
    status: "working",
    blurb: "Red flags raised by a call, with the SLA clock running against a named person.",
    roles: ["Doctor", "Nurse"],
    tour: 9,
    steps: [
      { who: "Clinician", text: "Acknowledge the escalation — your name and the time are stamped on it." },
      { who: "Clinician", text: "Resolve it with what you actually did." },
    ],
    tip: "If no line answered the transfer, a high-priority callback task was raised instead. Nothing is ever dropped silently.",
  },
  {
    path: "/patients",
    title: "Patients",
    group: "Clinical",
    status: "working",
    blurb: "One permanent identity per hospital, with every visit hanging off it.",
    roles: ["Reception", "Nurse", "Doctor"],
    tour: 2,
    steps: [
      { who: "Reception", text: "Search by name, UHID, your old hospital id, or phone number." },
      { who: "Reception", text: "Register patient creates the permanent record. Enter a date of birth, never an age — age is calculated from it everywhere." },
      { who: "Reception", text: "Import patients loads your existing spreadsheet." },
    ],
    tip: "If a patient with the same mobile and date of birth already exists, you are shown them instead of creating a second chart.",
  },
  {
    path: "/patients/import",
    title: "Import patients",
    group: "Clinical",
    status: "working",
    blurb: "Upload the spreadsheet you already have, with your own column headings.",
    roles: ["Reception", "Nurse", "Hospital admin"],
    tour: 3,
    steps: [
      { who: "Reception", text: "Drop in your .xlsx or .csv. You do not have to use our template." },
      { who: "Reception", text: "Check the mapping. 'Phone No.', 'Contact Number' and 'Mobile' all land on the same field automatically; correct anything it missed.", note: "Your corrections are remembered, so the next import from the same system maps itself." },
      { who: "Reception", text: "Read the preview: valid, invalid, possible duplicates. Click any row to see the raw spreadsheet row and exactly what is wrong with it." },
      { who: "Reception", text: "Choose per row: create new, use existing, update existing or skip. Then press Import." },
      { who: "Reception", text: "Download the error report, fix those rows in your file, and re-upload just them." },
    ],
    tip: "Nothing is written until you press Import. And a spreadsheet never silently overwrites a value a clinician entered — conflicts are shown side by side and default to keeping yours.",
  },
  {
    path: "/appointments",
    title: "Appointments",
    group: "Clinical",
    status: "working",
    blurb: "The booking calendar the AI receptionist and the front desk share.",
    roles: ["Reception"],
    steps: [
      { who: "Reception", text: "Book into a doctor's slot. The slot is locked while you confirm, so two people cannot take it at once." },
    ],
  },

  /* ---------------------------------------------------------- operations */
  {
    path: "/admissions",
    title: "Admissions & wards",
    group: "Hospital operations",
    status: "working",
    blurb: "Hospital → building → ward → room → bed. A patient is held by an admission, never by a ward.",
    roles: ["Nurse", "Doctor", "Hospital admin"],
    tour: 5,
    steps: [
      { who: "Nurse", text: "Ward board shows every bed colour-coded by state. Click a free bed to change its housekeeping status; click an occupied one to transfer that patient." },
      { who: "Nurse", text: "Admit a patient — choose an already-registered patient, the admission type and a free bed." },
      { who: "Nurse", text: "Transfer requires a reason and who authorised it. Both are mandatory and both are kept." },
      { who: "Doctor", text: "Discharge requires a final diagnosis and a discharge summary." },
      { who: "Housekeeping", text: "A released bed goes to CLEANING, not straight back to available. Set it to AVAILABLE in Bed management when the bay is turned over." },
    ],
    tip: "If two people claim the same free bed in the same instant, exactly one wins and the other is told to pick another. The database enforces that, not the screen.",
  },
  {
    path: "/ot",
    title: "Operation theatre",
    group: "Hospital operations",
    status: "gap",
    blurb: "A day board across theatres — which you can read and progress, but not yet plan.",
    roles: ["OT nurse", "Surgeon"],
    steps: [
      { who: "Anyone", text: "Move day by day with the arrows, then click a case to open it." },
      { who: "OT nurse", text: "Mark the WHO surgical safety checklist complete." },
      { who: "OT nurse", text: "Start the case, and later mark it completed — which schedules the day-2 post-operative follow-up call." },
    ],
    gap: "You cannot schedule a case, cancel one, or slot an emergency. The cancelled state and the emergency priority exist in the data and the board even styles them, but nothing in the interface can set either. Booking a theatre, a surgeon and a slot has no screen at all.",
  },
  {
    path: "/laboratory",
    title: "Laboratory",
    group: "Hospital operations",
    status: "working",
    blurb: "A workflow, not a form: ordered → collected → processing → resulted → verified → released.",
    roles: ["Lab technician", "Nurse", "Doctor"],
    tour: 7,
    steps: [
      { who: "Doctor", text: "Order the test from the patient's profile, not from here." },
      { who: "Nurse", text: "Open the card in the Ordered column and press Collect sample. A sample id is issued." },
      { who: "Lab technician", text: "Start processing, then type a value for each analyte. The reference range sits beside every field." },
      { who: "Lab technician", text: "Verify, then Release to the ward." },
      { who: "Doctor", text: "Acknowledge any critical result and record the clinical action you took." },
    ],
    tip: "A step cannot be skipped and nothing moves backwards. A verified result can only be amended — with a reason — and the previous version is kept as version 1.",
  },
  {
    path: "/pharmacy",
    title: "Pharmacy",
    group: "Hospital operations",
    status: "partial",
    blurb: "Stock levels, reorder alerts, expiry within 90 days and Schedule H tracking.",
    roles: ["Pharmacist"],
    steps: [
      { who: "Pharmacist", text: "Filter to Below reorder level to see what needs ordering." },
      { who: "Pharmacist", text: "Press Reorder, set the quantity, confirm. The stock level genuinely increases and survives a refresh." },
    ],
    gap: "Registering a new medicine does not exist — there is no add-item form anywhere, so the catalogue is fixed at whatever setup created. There is no dispensing either, so stock only ever goes up.",
  },
  {
    path: "/emergency",
    title: "Emergency & triage",
    group: "Hospital operations",
    status: "working",
    blurb: "Arrivals, triage category and who is treating them.",
    roles: ["Nurse", "Reception"],
    steps: [{ who: "Nurse", text: "Set the triage level and assign a clinician." }],
  },

  /* ------------------------------------------------- engagement, revenue */
  {
    path: "/messages",
    title: "WhatsApp / SMS inbox",
    group: "Engagement & revenue",
    status: "working",
    blurb: "Two-way patient messaging with a clean handover from agent to human.",
    roles: ["Reception", "Nurse"],
    steps: [{ who: "Anyone", text: "Reply directly. The agent stands down as soon as a person joins the thread." }],
  },
  {
    path: "/billing",
    title: "Billing & invoices",
    group: "Engagement & revenue",
    status: "working",
    blurb: "Invoices, payer mix and what is outstanding.",
    roles: ["Billing"],
    steps: [{ who: "Billing", text: "Raise, issue and record payment against an invoice." }],
    gap: "No payment gateway is wired. Invoices are recorded; nothing is charged.",
  },
  {
    path: "/data",
    title: "Excel import / export",
    group: "Engagement & revenue",
    status: "working",
    blurb: "The export side of bulk data work.",
    roles: ["Hospital admin", "Billing"],
    steps: [{ who: "Admin", text: "For patient import, use Patients → Import patients. This screen sends you there." }],
  },
  {
    path: "/exports",
    title: "Export centre",
    group: "Engagement & revenue",
    status: "working",
    blurb: "Seven governed report templates, scoped to your role.",
    roles: ["Hospital admin", "Billing", "Doctor"],
    steps: [
      { who: "Anyone with export rights", text: "Pick a template, choose whether to mask phone numbers, and generate." },
      { who: "Anyone with export rights", text: "Collect the file from the single-use link — it expires in an hour." },
    ],
    tip: "Your role decides the columns. Ask for clinical free text without the permission and the column comes back marked [restricted] — not an error you can work around.",
  },

  /* ------------------------------------------------------- administration */
  {
    path: "/admin/users",
    title: "Users & roles",
    group: "Administration",
    status: "working",
    blurb: "Invite staff, set their role, and adjust individual permissions on top of it.",
    roles: ["Hospital admin"],
    tour: 10,
    steps: [
      { who: "Admin", text: "Invite with name, work email and role." },
      { who: "Admin", text: "Grant or revoke individual permissions only where you have a specific reason. Role defaults are deliberately tight." },
      { who: "Admin", text: "Prefer Suspend over Remove — it revokes any live session immediately and keeps the person's name on everything they signed." },
    ],
  },
  {
    path: "/admin/agents",
    title: "AI agent configuration",
    group: "Administration",
    status: "working",
    blurb: "The agents that speak to patients — and the publish gate that stops them.",
    roles: ["Hospital admin"],
    tour: 12,
    steps: [
      { who: "Admin", text: "Review the agent's purpose, languages, identity verification, capabilities and escalation target." },
      { who: "Admin", text: "Press Publish. Nothing dials a patient until a human does this." },
      { who: "Admin", text: "Editing a live agent creates a new draft version and leaves the live one untouched until you publish again." },
    ],
  },
  {
    path: "/admin/protocols",
    title: "Clinical protocols",
    group: "Administration",
    status: "working",
    blurb: "Your questionnaires and red-flag rules, versioned and signed off by a named clinician.",
    roles: ["Clinical lead", "Hospital admin"],
    tour: 11,
    steps: [
      { who: "Clinical lead", text: "Read the questionnaire and the red-flag rules line by line." },
      { who: "Clinical lead", text: "Press Send for clinical sign-off. Your name and the time are stamped on the protocol and on every call that runs it." },
    ],
    tip: "Red flags are deterministic rules, not a model's judgment. That is why an incident review can reconstruct exactly what the patient was asked.",
  },
  {
    path: "/admin/org",
    title: "Hospital & departments",
    group: "Administration",
    status: "gap",
    blurb: "Facilities, departments, doctors and their booking rules.",
    roles: ["Hospital admin"],
    steps: [
      { who: "Admin", text: "Read the facilities, departments, doctors and calendars that setup created." },
    ],
    gap: "The Add button does not save anything. It shows a success message and writes a misleading audit line, but no doctor, department or branch is created. Until it is fixed, doctors can only be added during the nine-step setup wizard — so put every consultant in there.",
  },
  {
    path: "/settings/voice",
    title: "Voice providers",
    group: "Administration",
    status: "working",
    blurb: "Your own Retell and ElevenLabs accounts — or the built-in simulator.",
    roles: ["Hospital admin"],
    tour: 13,
    steps: [
      { who: "Admin", text: "Paste your API key, pick the agent and the voice loaded live from your account." },
      { who: "Admin", text: "Press Test connection — it reports the real result, not a guess." },
      { who: "Admin", text: "Press Preview the voice to hear what a patient will hear." },
    ],
    tip: "Keys are stored server-side and returned to the browser masked. Re-saving a masked value keeps the stored secret.",
  },
  {
    path: "/settings/storage",
    title: "Storage & retention",
    group: "Administration",
    status: "working",
    blurb: "Where recordings live — your disk, or your own S3, R2, MinIO or Wasabi bucket.",
    roles: ["Hospital admin"],
    steps: [
      { who: "Admin", text: "Choose local or paste your bucket credentials, then press Test connection." },
      { who: "Admin", text: "Set separate retention for audio, transcripts and clinical summaries. A summary stays useful for years; raw audio rarely needs to." },
    ],
    tip: "Test connection does a real write, read-back and delete, and tells you exactly what happened at each step.",
  },
  {
    path: "/settings/escalation",
    title: "Escalation routing",
    group: "Administration",
    status: "working",
    blurb: "Where a critical call goes, and who has to answer for it.",
    roles: ["Hospital admin", "Clinical lead"],
    tour: 14,
    steps: [
      { who: "Admin", text: "Set the main line, the after-hours number, the fallback, the on-call rota and the acknowledgement SLA." },
      { who: "Admin", text: "Choose the transfer mode: warm, cold or conference." },
    ],
    tip: "With no main line configured the platform refuses to start a protocol call at all, rather than risk a red flag with nowhere to send it.",
  },
  {
    path: "/settings/plan",
    title: "Plan & usage",
    group: "Administration",
    status: "working",
    blurb: "Seats, voice minutes and which of the eighteen modules are unlocked.",
    roles: ["Hospital admin"],
    steps: [
      { who: "Admin", text: "Turn a module on and it appears in the sidebar for everyone with the right role immediately." },
    ],
    tip: "A locked module is not just hidden — its pages refuse to render, and the server refuses its API calls.",
  },
  {
    path: "/admin/telephony",
    title: "Telephony",
    group: "Administration",
    status: "working",
    blurb: "Caller id, DLT header and template registration for lawful outbound calling in India.",
    roles: ["Hospital admin"],
    steps: [
      { who: "Admin", text: "Register as a Principal Entity on your access provider's DLT platform first." },
      { who: "Admin", text: "Notify them in advance, in writing, that you will use an auto-dialler. TCCCPR requires it." },
    ],
    tip: "Mix one promotional line into a clinical call and the whole call is reclassified as promotional — and blocked.",
  },
  {
    path: "/admin/integrations",
    title: "Integrations & FHIR",
    group: "Administration",
    status: "partial",
    blurb: "Where an HIS, a FHIR endpoint or ABDM would connect.",
    roles: ["Hospital admin"],
    steps: [{ who: "Admin", text: "Review what a real integration would need." }],
    gap: "No HIS or ABDM integration is built. There is no ABHA linking and no consent-manager exchange yet.",
  },
  {
    path: "/admin/audit",
    title: "Audit trail",
    group: "Administration",
    status: "working",
    blurb: "Who did what, to whom, when — append-only.",
    roles: ["Hospital admin", "Compliance"],
    tour: 15,
    steps: [
      { who: "Admin", text: "Filter by actor, action or severity." },
      { who: "Admin", text: "For clinical changes, open the patient's Audit history tab — it carries the before and after values too." },
    ],
    tip: "Clinical records are amended, never deleted. The audit row plus the record's own status is the complete history of what a clinician saw and when.",
  },
  {
    path: "/admin/system",
    title: "System status",
    group: "Administration",
    status: "working",
    blurb: "Is the software healthy, and when was the last backup?",
    roles: ["Hospital admin", "IT"],
    steps: [
      { who: "Admin", text: "Check the top banner: serving normally, serving with something to attend to, or not serving." },
      { who: "Admin", text: "Look at the 'Database — writing' check. It is the one that catches a full disk, where reads keep working and saves stop." },
      { who: "IT", text: "Point an uptime monitor at /api/health — it answers 503 when something is failing, so you are told rather than finding out." },
      { who: "IT", text: "Run npm run backup on a schedule and copy each generation off this machine." },
    ],
    gap: "There is no alerting and no failover. This screen tells you when you look at it, and if the process stops the hospital has no system at all until someone restarts it.",
    tip: "Rehearse a restore before you need one: npm run test:disaster takes a backup, destroys the database, restores it and checks what came back.",
  },
  {
    path: "/platform",
    title: "Tenant console",
    group: "Platform",
    status: "working",
    blurb: "Every hospital on the platform, their trials, usage and incidents.",
    roles: ["Platform super admin"],
    steps: [{ who: "Platform admin", text: "Review tenants, trial states and voice minute usage." }],
    tip: "A platform administrator deliberately has no access to patient clinical data. Running the SaaS is not a clinical role.",
  },
  {
    path: "/portal",
    title: "My health",
    group: "Patient",
    status: "working",
    blurb: "What the patient sees of their own record.",
    roles: ["Patient"],
    steps: [{ who: "Patient", text: "View appointments, released results and messages." }],
  },
];

/** The dynamic patient profile, matched by prefix rather than exactly. */
export const PATIENT_PROFILE: GuideEntry = {
  path: "/patients/",
  title: "Patient profile",
  group: "Clinical",
  status: "working",
  blurb: "The whole chart for one person, in one tenant-scoped payload.",
  roles: ["Doctor", "Nurse", "Reception"],
  tour: 4,
  steps: [
    { who: "Anyone", text: "The band across the top is what matters in an emergency: current admission, allergies, latest vitals, active medications and any unacknowledged critical result." },
    { who: "Nurse", text: "Record vitals — each reading is its own timestamped record, and implausible values are refused with a reason." },
    { who: "Doctor", text: "New encounter writes the structured note. Editing it later snapshots the previous version first." },
    { who: "Doctor", text: "Prescribe with structured dose, route, frequency and duration. If the medicine matches a recorded allergy you must type an override reason." },
    { who: "Doctor", text: "Order lab sends the request to the laboratory board." },
    { who: "Anyone", text: "Timeline shows every event in order, each linking to the record that produced it." },
  ],
  tip: "For a user without clinical view, the clinical sections are absent from the server's response — not hidden in the browser. There is nothing to find in the network tab.",
};

const ALL = [...GUIDE, PATIENT_PROFILE];

/** Finds the guide entry for a route, preferring the longest matching path. */
export function entryForPath(pathname: string): GuideEntry | null {
  const exact = ALL.find((e) => e.path === pathname);
  if (exact) return exact;
  if (/^\/patients\/[^/]+$/.test(pathname)) return PATIENT_PROFILE;
  const prefixed = ALL
    .filter((e) => e.path !== "/" && pathname.startsWith(e.path))
    .sort((a, b) => b.path.length - a.path.length);
  return prefixed[0] ?? null;
}

/** The guided tour, in the order a new hospital should meet the product. */
export const TOUR: GuideEntry[] = ALL
  .filter((e) => typeof e.tour === "number")
  .sort((a, b) => (a.tour ?? 0) - (b.tour ?? 0));

export const STATUS_LABEL: Record<GuideStatus, string> = {
  working: "Working",
  partial: "Half built",
  gap: "Not built yet",
};

/** Opening lines, so Mitra does not say the same thing every time. */
export const GREETINGS = [
  "Want me to explain this screen?",
  "New here? I can walk you through it.",
  "I know every screen in this hospital.",
  "Ask me what this page does.",
];
