/** Export templates available to every tenant. */
export const EXPORT_TEMPLATES = [
  { id: "patients", label: "Patient register", sensitive: true },
  { id: "followups", label: "Follow-up outcomes", sensitive: true },
  { id: "calls", label: "Call log", sensitive: true },
  { id: "escalations", label: "Escalation & SLA report", sensitive: true },
  { id: "appointments", label: "Appointment register", sensitive: false },
  { id: "billing", label: "Billing summary", sensitive: false },
  { id: "recordings", label: "Recording inventory", sensitive: true },
] as const;
