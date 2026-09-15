import type { Permission } from "@/lib/types";
import type { RecordKind } from "./provision";

/** Which permission is required to write each entity type. Reads are covered by the tenant scope. */
export const WRITE_PERMISSION: Record<RecordKind, Permission> = {
  facility: "org.configure",
  department: "org.configure",
  provider: "org.configure",
  patient: "patients.edit",
  appointment: "appointments.manage",
  call: "calls.initiate",
  escalation: "escalations.resolve",
  task: "queue.care",
  campaign: "campaigns.manage",
  agent: "agents.configure",
  protocol: "protocols.configure",
  ward: "ipd.manage",
  bed: "ipd.manage",
  otSlot: "ot.manage",
  drug: "pharmacy.manage",
  labOrder: "labs.manage",
  emergencyCase: "emergency.manage",
  invoice: "billing.manage",
  thread: "messaging.use",
  importJob: "data.import",
  integration: "integrations.configure",
};

/**
 * Which permission is required to *read* each entity type.
 *
 * Tenant scope alone is not authorisation. A patient-portal account and a
 * pharmacist are both inside the tenant, and neither should be handed the
 * hospital's call transcripts because they happened to ask for the workspace's
 * cached lists. Every collection served to the browser is filtered through
 * this map, so a role's reach is the same whether it arrives one record at a
 * time or as a bulk payload.
 */
export const READ_PERMISSION: Record<RecordKind, Permission> = {
  facility: "patients.view",
  department: "patients.view",
  provider: "patients.view",
  patient: "patients.view",
  appointment: "appointments.manage",
  call: "calls.view",
  escalation: "escalations.view",
  task: "queue.care",
  campaign: "campaigns.manage",
  agent: "agents.configure",
  protocol: "patients.view",
  ward: "ipd.manage",
  bed: "ipd.manage",
  otSlot: "ot.manage",
  drug: "pharmacy.manage",
  labOrder: "labs.manage",
  emergencyCase: "emergency.manage",
  invoice: "billing.manage",
  thread: "messaging.use",
  importJob: "data.import",
  integration: "integrations.configure",
};

/** Human label used in audit lines. */
export const KIND_LABEL: Record<RecordKind, string> = {
  facility: "Facility", department: "Department", provider: "Doctor", patient: "Patient",
  appointment: "Appointment", call: "Call", escalation: "Escalation", task: "Task",
  campaign: "Campaign", agent: "AI agent", protocol: "Clinical protocol", ward: "Ward", bed: "Bed",
  otSlot: "OT case", drug: "Pharmacy item", labOrder: "Lab order", emergencyCase: "Emergency case",
  invoice: "Invoice", thread: "Message thread", importJob: "Import job", integration: "Integration",
};

/** A short descriptor for a record, used for audit targets. */
export function describe(kind: RecordKind, data: Record<string, unknown>): string {
  const name =
    (data.name as string) ??
    (data.patientName as string) ??
    (data.number as string) ??
    (data.title as string) ??
    (data.procedure as string) ??
    (data.panel as string) ??
    (data.trigger as string) ??
    (data.id as string) ??
    "";
  return `${KIND_LABEL[kind]} ${name}`.trim();
}
