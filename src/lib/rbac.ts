import type { Permission, Role, User } from "./types";

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Platform Super Admin",
  hospital_admin: "Hospital Admin",
  doctor: "Doctor",
  nurse: "Nurse / Care Coordinator",
  receptionist: "Reception / Front Desk",
  pharmacist: "Pharmacist",
  lab_tech: "Lab Technician",
  billing: "Billing & Accounts",
  patient: "Patient (portal)",
};

export const ALL_PERMISSIONS: { key: Permission; label: string; group: string }[] = [
  { key: "tenant.manage", label: "Manage hospitals / tenants", group: "Platform" },
  { key: "org.configure", label: "Configure organisation & branches", group: "Administration" },
  { key: "users.manage", label: "Manage users & roles", group: "Administration" },
  { key: "agents.configure", label: "Configure AI agents", group: "Administration" },
  { key: "protocols.configure", label: "Configure clinical protocols", group: "Administration" },
  { key: "telephony.configure", label: "Configure telephony", group: "Administration" },
  { key: "integrations.configure", label: "Configure integrations", group: "Administration" },
  { key: "audit.view", label: "View audit trail", group: "Administration" },
  { key: "patients.view", label: "View patient directory", group: "Clinical" },
  { key: "patients.clinical.view", label: "View clinical details", group: "Clinical" },
  { key: "patients.edit", label: "Edit patient demographics", group: "Clinical" },
  { key: "patients.register", label: "Register new patients & import", group: "Front desk" },
  { key: "encounters.write", label: "Write clinical encounters & diagnoses", group: "Clinical" },
  { key: "vitals.record", label: "Record vital signs", group: "Clinical" },
  { key: "prescriptions.write", label: "Prescribe medication", group: "Clinical" },
  { key: "admissions.manage", label: "Admit, transfer & discharge", group: "Operations" },
  { key: "labs.order", label: "Order laboratory tests", group: "Laboratory" },
  { key: "labs.collect", label: "Collect & receive samples", group: "Laboratory" },
  { key: "labs.result", label: "Enter laboratory results", group: "Laboratory" },
  { key: "labs.verify", label: "Verify & release results", group: "Laboratory" },
  { key: "appointments.manage", label: "Manage appointments", group: "Front desk" },
  { key: "calls.view", label: "View calls & summaries", group: "Voice" },
  { key: "calls.listen", label: "Play call recordings", group: "Voice" },
  { key: "calls.takeover", label: "Take over a live call", group: "Voice" },
  { key: "calls.initiate", label: "Start an outbound AI call", group: "Voice" },
  { key: "campaigns.manage", label: "Manage follow-up campaigns", group: "Voice" },
  { key: "escalations.view", label: "View escalations", group: "Clinical" },
  { key: "escalations.resolve", label: "Acknowledge & resolve escalations", group: "Clinical" },
  { key: "queue.care", label: "Care coordinator queue", group: "Clinical" },
  { key: "queue.doctor", label: "Doctor review queue", group: "Clinical" },
  { key: "ipd.manage", label: "Beds & admissions", group: "Operations" },
  { key: "ot.manage", label: "Operation theatre schedule", group: "Operations" },
  { key: "pharmacy.manage", label: "Pharmacy & stock", group: "Operations" },
  { key: "labs.manage", label: "Lab orders & results", group: "Operations" },
  { key: "emergency.manage", label: "Emergency & triage", group: "Operations" },
  { key: "billing.manage", label: "Billing & invoices", group: "Finance" },
  { key: "messaging.use", label: "WhatsApp / SMS inbox", group: "Engagement" },
  { key: "data.import", label: "Import Excel / CSV", group: "Data" },
  { key: "data.export", label: "Export governed reports", group: "Data" },
  { key: "analytics.view", label: "View analytics", group: "Data" },
  { key: "portal.self", label: "Patient self-service", group: "Patient" },
];

const P = (...p: Permission[]) => p;

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  /**
   * A platform administrator runs the SaaS. That is not a clinical role, so it
   * does NOT carry patient clinical access: no chart, no results, no
   * prescriptions. Tenant, billing and configuration only. A hospital can still
   * grant a named individual extra permissions explicitly if it chooses to.
   */
  super_admin: P(
    "tenant.manage", "org.configure", "users.manage", "audit.view",
    "integrations.configure", "telephony.configure", "analytics.view",
  ),
  hospital_admin: P(
    "org.configure", "users.manage", "agents.configure", "protocols.configure", "telephony.configure",
    "integrations.configure", "audit.view", "patients.view", "patients.clinical.view", "patients.edit",
    "patients.register", "appointments.manage", "calls.view", "calls.listen", "calls.initiate",
    "campaigns.manage", "escalations.view", "escalations.resolve", "queue.care", "queue.doctor",
    "ipd.manage", "admissions.manage", "ot.manage", "pharmacy.manage", "labs.manage", "labs.order",
    "emergency.manage", "billing.manage", "messaging.use", "data.import", "data.export", "analytics.view",
  ),
  doctor: P(
    "patients.view", "patients.clinical.view", "patients.edit", "patients.register",
    "encounters.write", "vitals.record", "prescriptions.write", "admissions.manage",
    "appointments.manage", "calls.view", "calls.listen", "calls.initiate",
    "escalations.view", "escalations.resolve", "queue.doctor",
    "ipd.manage", "ot.manage", "labs.manage", "labs.order", "analytics.view", "messaging.use", "data.export",
  ),
  nurse: P(
    "patients.view", "patients.clinical.view", "patients.register", "vitals.record",
    "appointments.manage", "calls.view", "calls.listen",
    "calls.initiate", "campaigns.manage", "escalations.view", "escalations.resolve", "queue.care",
    "ipd.manage", "admissions.manage", "labs.manage", "labs.collect", "emergency.manage",
    "messaging.use", "data.import", "analytics.view",
  ),
  /**
   * Reception registers patients and books appointments. It deliberately has no
   * clinical view, no clinical editing, no prescribing and no lab permissions.
   */
  receptionist: P(
    "patients.view", "patients.register", "patients.edit", "appointments.manage",
    "calls.view", "calls.initiate", "messaging.use", "data.import", "analytics.view",
  ),
  pharmacist: P("patients.view", "pharmacy.manage", "analytics.view"),
  lab_tech: P(
    "patients.view", "labs.manage", "labs.collect", "labs.result", "labs.verify", "analytics.view",
  ),
  billing: P("patients.view", "billing.manage", "analytics.view", "data.export"),
  patient: P("portal.self"),
};

export function effectivePermissions(user: User): Set<Permission> {
  const base = new Set<Permission>(ROLE_PERMISSIONS[user.role]);
  for (const p of user.extraPermissions) base.add(p);
  for (const p of user.revokedPermissions) base.delete(p);
  return base;
}

export function can(user: User | null, permission: Permission): boolean {
  if (!user) return false;
  return effectivePermissions(user).has(permission);
}
