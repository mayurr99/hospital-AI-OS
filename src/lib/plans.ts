/** One pricing source shared by the public site and both administration screens. */
export const PLAN_CATALOG = [
  {
    key: "front_desk",
    name: "AI Front Desk",
    price: 150_000,
    blurb: "Receptionist, appointments, reminders and messaging.",
    minutes: 5_000,
    seats: 25,
  },
  {
    key: "care",
    name: "AI Care",
    price: 350_000,
    blurb: "Front desk plus follow-up agent, clinical queues and escalation.",
    minutes: 20_000,
    seats: 100,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    price: 0,
    blurb: "Multi-hospital, HIS/FHIR, SSO, dedicated deployment and SLA.",
    minutes: 0,
    seats: 0,
  },
] as const;

export type PaidPlanKey = (typeof PLAN_CATALOG)[number]["key"];
export const SUBSCRIPTION_PLAN_KEYS = ["trial", ...PLAN_CATALOG.map((plan) => plan.key)] as const;

