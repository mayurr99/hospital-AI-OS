import type { Permission } from "./types";

export interface NavItem {
  href: string;
  label: string;
  icon: string; // lucide icon name
  permission?: Permission;
  /** module key from the subscription's unlocked feature set */
  feature?: string;
  badge?: "escalations" | "tasks" | "messages" | "live";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
      { href: "/analytics", label: "Analytics & ROI", icon: "TrendingUp", permission: "analytics.view", feature: "analytics" },
    ],
  },
  {
    label: "AI voice",
    items: [
      { href: "/live", label: "Live call console", icon: "Radio", permission: "calls.view", badge: "live" },
      { href: "/receptionist", label: "AI receptionist", icon: "PhoneIncoming", permission: "calls.view", feature: "ai_receptionist" },
      { href: "/campaigns", label: "Follow-up campaigns", icon: "Megaphone", permission: "campaigns.manage", feature: "followup_agent" },
      { href: "/calls", label: "Call history", icon: "PhoneCall", permission: "calls.view" },
      { href: "/recordings", label: "Recordings", icon: "Mic", permission: "calls.view", feature: "call_recording" },
    ],
  },
  {
    label: "Clinical",
    items: [
      { href: "/doctor-crm", label: "Doctor review queue", icon: "Stethoscope", permission: "queue.doctor", feature: "doctor_crm" },
      { href: "/care-queue", label: "Care coordinator queue", icon: "ClipboardList", permission: "queue.care", feature: "care_queue", badge: "tasks" },
      { href: "/escalations", label: "Escalations", icon: "Siren", permission: "escalations.view", feature: "escalation", badge: "escalations" },
      { href: "/patients", label: "Patients", icon: "Users", permission: "patients.view" },
      { href: "/patients/import", label: "Import patients", icon: "FileSpreadsheet", permission: "data.import", feature: "data_io" },
      { href: "/appointments", label: "Appointments", icon: "CalendarDays", permission: "appointments.manage", feature: "appointments" },
    ],
  },
  {
    label: "Hospital operations",
    items: [
      { href: "/admissions", label: "Admissions & wards", icon: "BedDouble", permission: "ipd.manage", feature: "ipd" },
      { href: "/ot", label: "Operation theatre", icon: "Activity", permission: "ot.manage", feature: "ot" },
      { href: "/laboratory", label: "Laboratory", icon: "FlaskConical", permission: "labs.manage", feature: "labs" },
      { href: "/pharmacy", label: "Pharmacy", icon: "Pill", permission: "pharmacy.manage", feature: "pharmacy" },
      { href: "/emergency", label: "Emergency & triage", icon: "Ambulance", permission: "emergency.manage", feature: "emergency" },
    ],
  },
  {
    label: "Engagement & revenue",
    items: [
      { href: "/messages", label: "WhatsApp / SMS inbox", icon: "MessageSquare", permission: "messaging.use", feature: "messaging", badge: "messages" },
      { href: "/billing", label: "Billing & invoices", icon: "Receipt", permission: "billing.manage", feature: "billing" },
      { href: "/data", label: "Excel import / export", icon: "FileSpreadsheet", permission: "data.import", feature: "data_io" },
      { href: "/exports", label: "Export centre", icon: "Download", permission: "data.export", feature: "data_io" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/users", label: "Users & roles", icon: "ShieldCheck", permission: "users.manage" },
      { href: "/admin/agents", label: "AI agent configuration", icon: "Bot", permission: "agents.configure" },
      { href: "/admin/protocols", label: "Clinical protocols", icon: "FileCheck2", permission: "protocols.configure" },
      { href: "/admin/org", label: "Hospital & departments", icon: "Building2", permission: "org.configure" },
      { href: "/settings/voice", label: "Voice providers", icon: "Mic2", permission: "agents.configure" },
      { href: "/settings/storage", label: "Storage & retention", icon: "HardDrive", permission: "org.configure" },
      { href: "/settings/escalation", label: "Escalation routing", icon: "PhoneForwarded", permission: "protocols.configure" },
      { href: "/settings/plan", label: "Plan & usage", icon: "CreditCard", permission: "org.configure" },
      { href: "/admin/telephony", label: "Telephony", icon: "Phone", permission: "telephony.configure" },
      { href: "/admin/integrations", label: "Integrations & FHIR", icon: "Plug", permission: "integrations.configure", feature: "integrations" },
      { href: "/admin/audit", label: "Audit trail", icon: "ScrollText", permission: "audit.view" },
      { href: "/admin/system", label: "System status", icon: "Activity", permission: "org.configure" },
    ],
  },
  {
    label: "Platform",
    items: [{ href: "/platform", label: "Tenant console", icon: "Globe2", permission: "tenant.manage" }],
  },
  {
    label: "Patient",
    items: [{ href: "/portal", label: "My health", icon: "HeartPulse", permission: "portal.self" }],
  },
];
