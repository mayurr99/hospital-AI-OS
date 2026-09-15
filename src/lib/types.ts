// Hospital AI OS — domain model
// Multi-tenant AI patient engagement, voice and care automation platform.

export type Role =
  | "super_admin"
  | "hospital_admin"
  | "doctor"
  | "nurse"
  | "receptionist"
  | "pharmacist"
  | "lab_tech"
  | "billing"
  | "patient";

export type Permission =
  | "tenant.manage"
  | "org.configure"
  | "users.manage"
  | "agents.configure"
  | "protocols.configure"
  | "telephony.configure"
  | "integrations.configure"
  | "audit.view"
  | "patients.view"
  | "patients.clinical.view"
  | "patients.edit"
  | "patients.register"
  | "encounters.write"
  | "vitals.record"
  | "prescriptions.write"
  | "admissions.manage"
  | "labs.order"
  | "labs.collect"
  | "labs.result"
  | "labs.verify"
  | "appointments.manage"
  | "calls.view"
  | "calls.listen"
  | "calls.takeover"
  | "calls.initiate"
  | "campaigns.manage"
  | "escalations.view"
  | "escalations.resolve"
  | "queue.care"
  | "queue.doctor"
  | "ipd.manage"
  | "ot.manage"
  | "pharmacy.manage"
  | "labs.manage"
  | "emergency.manage"
  | "billing.manage"
  | "messaging.use"
  | "data.import"
  | "data.export"
  | "analytics.view"
  | "portal.self";

export type RiskLevel = "green" | "amber" | "red";
export type LanguageCode = "mr" | "hi" | "en" | "hinglish";

export interface Organization {
  id: string;
  name: string;
  shortName: string;
  plan: "front_desk" | "care" | "enterprise";
  city: string;
  state: string;
  timezone: string;
  primaryLanguages: LanguageCode[];
  accentColor: string;
  logoInitials: string;
  status: "active" | "pilot" | "suspended";
  contractStart: string;
  voiceMinutesIncluded: number;
  voiceMinutesUsed: number;
  monthlyFee: number;
  deployment: "shared_saas" | "dedicated_vpc" | "on_prem";
  integrationStatus: "not_started" | "in_progress" | "live";
  openIncidents: number;
}

export interface Facility {
  id: string;
  orgId: string;
  name: string;
  address: string;
  phone: string;
  beds: number;
  isPrimary: boolean;
}

export interface Department {
  id: string;
  orgId: string;
  facilityId: string;
  name: string;
  code: string;
  type: "clinical" | "admin" | "diagnostic";
}

export interface Provider {
  id: string;
  orgId: string;
  facilityId: string;
  departmentId: string;
  name: string;
  speciality: string;
  qualification: string;
  consultationMinutes: number;
  fee: number;
  workingDays: number[]; // 0 = Sunday
  startHour: number;
  endHour: number;
  languages: LanguageCode[];
  photoHue: number;
}

export interface User {
  id: string;
  orgId: string | null; // null = platform-level (super admin)
  facilityId: string | null;
  departmentId: string | null;
  providerId: string | null;
  name: string;
  email: string;
  phone: string;
  role: Role;
  extraPermissions: Permission[];
  revokedPermissions: Permission[];
  status: "active" | "invited" | "suspended";
  mfaEnabled: boolean;
  /** Has an authenticator actually been set up and proven on this account? */
  mfaEnrolled: boolean;
  lastLogin: string | null;
  createdAt: string;
}

export interface Patient {
  id: string;
  orgId: string;
  facilityId: string;
  mrn: string;
  name: string;
  age: number;
  gender: "M" | "F" | "O";
  phone: string;
  language: LanguageCode;
  departmentId: string;
  providerId: string;
  carePathway: string;
  diagnosis: string;
  allergies: string[];
  medications: { name: string; dose: string; frequency: string }[];
  consent: {
    clinicalCalls: boolean;
    marketing: boolean;
    whatsapp: boolean;
    recording: boolean;
    version: string;
    updatedAt: string;
  };
  status: "opd" | "ipd" | "discharged" | "followup";
  admittedAt?: string;
  dischargedAt?: string;
  lastContact: string | null;
  risk: RiskLevel;
  abhaId?: string;
}

export interface Appointment {
  id: string;
  orgId: string;
  facilityId: string;
  patientId: string;
  providerId: string;
  departmentId: string;
  start: string; // ISO
  durationMinutes: number;
  status: "booked" | "confirmed" | "completed" | "cancelled" | "no_show" | "held";
  source: "ai_receptionist" | "reception_desk" | "patient_portal" | "whatsapp" | "followup_call";
  reason: string;
  holdExpiresAt?: string;
  createdAt: string;
}

export interface TranscriptTurn {
  speaker: "agent" | "patient" | "system" | "staff";
  text: string;
  translation?: string;
  atSecond: number;
  flag?: "red" | "amber";
}

export interface CallSession {
  id: string;
  orgId: string;
  facilityId: string;
  patientId: string | null;
  patientName: string;
  phone: string;
  direction: "inbound" | "outbound";
  agentId: string;
  agentType: "receptionist" | "care";
  language: LanguageCode;
  startedAt: string;
  durationSeconds: number;
  status: "completed" | "no_answer" | "busy" | "transferred" | "in_progress" | "failed";
  outcome: string;
  risk: RiskLevel;
  reviewStatus: "not_required" | "pending" | "reviewed";
  reviewedBy?: string;
  sentimentScore: number; // 1-5
  transcript: TranscriptTurn[];
  structured: Record<string, string>;
  summary: string;
  recordingAvailable: boolean;
  costRupees: number;
  agentVersion: string;
  protocolVersion: string;
  modelVersion: string;
}

export interface Escalation {
  id: string;
  orgId: string;
  facilityId: string;
  patientId: string;
  callId: string | null;
  level: "red" | "amber";
  trigger: string;
  detail: string;
  raisedAt: string;
  assignedTo: string; // user id
  status: "open" | "acknowledged" | "resolved";
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  slaMinutes: number;
}

export interface Task {
  id: string;
  orgId: string;
  patientId: string;
  queue: "unreachable" | "callback" | "medication" | "appointment" | "review" | "critical";
  title: string;
  detail: string;
  assignedTo: string | null;
  priority: "low" | "normal" | "high";
  createdAt: string;
  dueAt: string;
  status: "open" | "in_progress" | "done";
}

export interface Campaign {
  id: string;
  orgId: string;
  name: string;
  agentType: "care" | "receptionist";
  protocolId: string;
  departmentId: string;
  cohortDescription: string;
  totalPatients: number;
  called: number;
  connected: number;
  completed: number;
  escalated: number;
  languages: LanguageCode[];
  window: string;
  retryPolicy: string;
  status: "draft" | "scheduled" | "running" | "paused" | "completed";
  startDate: string;
}

export interface Agent {
  id: string;
  orgId: string;
  name: string;
  type: "receptionist" | "care";
  departmentId: string | null;
  purpose: string;
  languages: LanguageCode[];
  identityVerification: "otp" | "dob_name" | "mrn" | "none";
  capabilities: string[];
  knowledgeScope: string;
  protocolId: string | null;
  escalationTarget: string;
  humanTransferNumber: string;
  recordingPolicy: "always" | "consent" | "never";
  retentionDays: number;
  maxTurns: number;
  version: string;
  status: "draft" | "published" | "paused";
  voice: string;
  publishedAt: string | null;
}

export interface ProtocolQuestion {
  id: string;
  text: Record<LanguageCode, string>;
  answerType: "yesno" | "scale" | "text" | "choice";
  choices?: string[];
  redIf?: string;
  amberIf?: string;
}

export interface Protocol {
  id: string;
  orgId: string;
  name: string;
  departmentId: string;
  version: string;
  status: "draft" | "approved" | "retired";
  approvedBy: string | null;
  approvedAt: string | null;
  questions: ProtocolQuestion[];
  redFlags: string[];
  escalationTarget: string;
  slaMinutes: number;
}

export interface Ward {
  id: string;
  orgId: string;
  facilityId: string;
  name: string;
  type: "general" | "icu" | "hdu" | "private" | "maternity" | "pediatric";
  floor: number;
}

export interface Bed {
  id: string;
  orgId: string;
  wardId: string;
  number: string;
  status: "available" | "occupied" | "cleaning" | "maintenance" | "reserved";
  patientId: string | null;
  admittedAt?: string;
  dailyRate: number;
}

export interface OTSlot {
  id: string;
  orgId: string;
  facilityId: string;
  theatre: string;
  start: string;
  durationMinutes: number;
  procedure: string;
  patientId: string | null;
  surgeonId: string;
  anaesthetist: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  checklistComplete: boolean;
  priority: "elective" | "emergency";
}

export interface Drug {
  id: string;
  orgId: string;
  name: string;
  form: string;
  strength: string;
  batch: string;
  expiry: string;
  stock: number;
  reorderLevel: number;
  unitPrice: number;
  supplier: string;
  scheduleH: boolean;
  /** When stock was last received into inventory, if it ever has been. */
  lastReceivedAt?: string;
}

export interface LabOrder {
  id: string;
  orgId: string;
  patientId: string;
  providerId: string;
  panel: string;
  tests: { name: string; value?: string; unit?: string; range?: string; abnormal?: boolean }[];
  orderedAt: string;
  status: "ordered" | "collected" | "processing" | "resulted" | "verified";
  priority: "routine" | "urgent" | "stat";
  criticalFlag: boolean;
  resultedAt?: string;
}

export interface EmergencyCase {
  id: string;
  orgId: string;
  facilityId: string;
  patientName: string;
  patientId: string | null;
  age: number;
  complaint: string;
  triage: 1 | 2 | 3 | 4 | 5;
  arrivalMode: "ambulance" | "walk_in" | "referral";
  arrivedAt: string;
  vitals: { bp: string; pulse: number; spo2: number; temp: number };
  assignedTo: string;
  status: "waiting" | "in_treatment" | "admitted" | "discharged" | "referred";
  ambulanceEta?: number;
}

export interface InvoiceLine {
  description: string;
  qty: number;
  rate: number;
  category: "consultation" | "procedure" | "pharmacy" | "lab" | "room" | "other";
}

export interface Invoice {
  id: string;
  orgId: string;
  patientId: string;
  number: string;
  issuedAt: string;
  lines: InvoiceLine[];
  discount: number;
  taxRate: number;
  paid: number;
  status: "draft" | "issued" | "part_paid" | "paid" | "overdue" | "insurance_pending";
  payer: "self" | "insurance" | "corporate" | "scheme";
  insurer?: string;
  paymentMode?: "upi" | "card" | "cash" | "netbanking";
}

export interface Message {
  id: string;
  orgId: string;
  patientId: string;
  channel: "whatsapp" | "sms";
  direction: "in" | "out";
  body: string;
  at: string;
  status: "sent" | "delivered" | "read" | "failed" | "received";
  templateName?: string;
  handledBy: "ai" | "staff";
}

export interface Thread {
  id: string;
  orgId: string;
  patientId: string;
  channel: "whatsapp" | "sms";
  lastAt: string;
  unread: number;
  assignedTo: string | null;
  aiHandling: boolean;
  messages: Message[];
}

export interface AuditLog {
  id: string;
  orgId: string | null;
  actor: string;
  actorRole: Role;
  action: string;
  target: string;
  at: string;
  ip: string;
  severity: "info" | "warning" | "critical";
}

export interface Integration {
  id: string;
  orgId: string;
  name: string;
  kind: "his" | "fhir" | "hl7" | "lab" | "pharmacy" | "sso" | "webhook" | "abdm" | "payment";
  vendor: string;
  status: "live" | "sandbox" | "error" | "not_configured";
  lastSync: string | null;
  recordsSynced: number;
  direction: "inbound" | "outbound" | "bidirectional";
  endpoint: string;
}

export interface TelephonyConfig {
  orgId: string;
  provider: string;
  aiNumber: string;
  fallbackNumber: string;
  transferDestinations: { label: string; number: string; hours: string }[];
  concurrentChannels: number;
  sipTrunk: string;
  status: "connected" | "degraded" | "disconnected";
  recordingStorage: string;
}

export interface ImportJob {
  id: string;
  orgId: string;
  fileName: string;
  uploadedBy: string;
  uploadedAt: string;
  totalRows: number;
  valid: number;
  issues: { type: string; count: number; sample: string }[];
  status: "validating" | "preview" | "imported" | "rejected";
}

export interface Incident {
  id: string;
  orgId: string;
  title: string;
  severity: "sev1" | "sev2" | "sev3";
  openedAt: string;
  status: "open" | "mitigated" | "closed";
  component: string;
}
