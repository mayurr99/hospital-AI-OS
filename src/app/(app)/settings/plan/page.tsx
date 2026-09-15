"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, PageHeader, Progress, StatTile } from "@/components/ui";
import { cx, fmtDate, inr } from "@/lib/utils";
import { CheckCircle2, CreditCard, Lock, Radio, Sparkles, Users, Zap } from "lucide-react";

const PLANS = [
  { key: "front_desk", name: "AI Front Desk", price: 200000, blurb: "Receptionist, appointments, reminders and messaging.", minutes: 5000, seats: 25 },
  { key: "care", name: "AI Care", price: 450000, blurb: "Front desk plus follow-up agent, clinical queues and escalation.", minutes: 20000, seats: 100 },
  { key: "enterprise", name: "Enterprise", price: 0, blurb: "Multi-hospital, HIS/FHIR, SSO, dedicated deployment and SLA.", minutes: 0, seats: 0 },
];

export default function PlanPage() {
  const { can, subscription, featureCatalog, org, users, notify } = useStore();
  const [pending, setPending] = useState<string[]>(subscription?.features ?? []);
  const [saving, setSaving] = useState(false);

  if (!can("org.configure")) return <Denied />;
  if (!subscription) return <p className="text-sm text-ink-500">Loading plan…</p>;

  const trialing = subscription.status === "trialing";
  const expired = subscription.status === "trial_expired";
  const minutePct = subscription.voiceMinutesCap ? Math.round((subscription.voiceMinutesUsed / subscription.voiceMinutesCap) * 100) : 0;
  const groups = Array.from(new Set(featureCatalog.map((f) => f.group)));
  const dirty = JSON.stringify([...pending].sort()) !== JSON.stringify([...subscription.features].sort());

  async function saveFeatures() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/features", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: pending }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not update modules");
      notify("Modules updated — the sidebar reflects this for everyone immediately");
      window.location.reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not update modules");
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Plan & usage"
        subtitle={`${org?.name} — subscription, voice consumption and which modules your staff can see`}
      />

      {(trialing || expired) && (
        <div className={cx("mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3", expired ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50")}>
          <Sparkles size={18} className={expired ? "text-rose-600" : "text-amber-600"} />
          <div className="min-w-[260px] flex-1">
            <p className={cx("text-sm font-semibold", expired ? "text-rose-900" : "text-amber-900")}>
              {expired ? "Your free trial has ended" : `${subscription.trialDaysLeft} day${subscription.trialDaysLeft === 1 ? "" : "s"} left in your free trial`}
            </p>
            <p className={cx("text-xs", expired ? "text-rose-700" : "text-amber-700")}>
              {expired
                ? "All your data is intact and the workspace stays readable. Patient calling resumes the moment a plan is active."
                : `Trial ends ${subscription.trialEndsAt ? fmtDate(subscription.trialEndsAt) : ""}. Nothing is deleted when it does.`}
            </p>
          </div>
          <Button variant={expired ? "danger" : "primary"} onClick={() => notify("Billing is not wired to a payment provider in this build — connect Razorpay or Stripe in the integrations layer")}>
            Choose a plan
          </Button>
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Plan" value={subscription.plan.replace("_", " ")} sub={subscription.status.replace("_", " ")} icon={<CreditCard size={15} />} tone="brand" />
        <StatTile label="Voice minutes" value={`${subscription.voiceMinutesUsed.toLocaleString("en-IN")}`} sub={`of ${subscription.voiceMinutesCap.toLocaleString("en-IN")} — ${minutePct}%`} icon={<Radio size={15} />} tone={minutePct > 85 ? "red" : minutePct > 60 ? "amber" : "green"} />
        <StatTile label="Staff seats" value={`${users.length} / ${subscription.seats}`} icon={<Users size={15} />} tone={users.length >= subscription.seats ? "red" : "neutral"} />
        <StatTile label="Modules unlocked" value={`${subscription.features.length} / ${featureCatalog.length}`} icon={<Zap size={15} />} />
      </div>

      <Card className="mb-4">
        <CardHeader title="Voice consumption this period" icon={<Radio size={16} />} />
        <Progress value={subscription.voiceMinutesUsed} max={Math.max(1, subscription.voiceMinutesCap)} tone={minutePct > 85 ? "red" : minutePct > 60 ? "amber" : "brand"} />
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-ink-500">
          <span>{subscription.voiceMinutesUsed.toLocaleString("en-IN")} minutes used</span>
          <span>≈ {inr(Math.round(subscription.voiceMinutesUsed * 4.2))} at the blended rate</span>
          <span>{Math.max(0, subscription.voiceMinutesCap - subscription.voiceMinutesUsed).toLocaleString("en-IN")} remaining</span>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
          Minutes are metered server-side on every completed call, so the number here is what actually ran — not an
          estimate. When the cap is reached, outbound calling stops rather than silently overspending your voice budget.
        </p>
      </Card>

      <Card className="mb-4">
        <CardHeader title="Modules" subtitle="Unlocking a module makes it appear for every user whose role allows it" icon={<Zap size={16} />}
          action={dirty ? <Button variant="primary" size="sm" onClick={saveFeatures} disabled={saving}>{saving ? "Saving…" : "Save modules"}</Button> : undefined}
        />
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{g}</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {featureCatalog.filter((f) => f.group === g).map((f) => {
                  const on = pending.includes(f.key);
                  return (
                    <button
                      key={f.key}
                      onClick={() => setPending(on ? pending.filter((x) => x !== f.key) : [...pending, f.key])}
                      className={cx("rounded-xl border p-3 text-left transition", on ? "border-brand-500 bg-brand-50" : "border-ink-200 hover:border-ink-300 hover:bg-ink-50")}
                    >
                      <div className="flex items-start gap-2">
                        <span className={cx("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded", on ? "bg-brand-600 text-white" : "bg-ink-200")}>
                          {on && <CheckCircle2 size={11} />}
                        </span>
                        <span>
                          <span className="block text-xs font-semibold text-ink-900">{f.label}</span>
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-600">{f.blurb}</span>
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Plans" subtitle="Indicative commercial bands — final pricing follows discovery" icon={<CreditCard size={16} />} />
        <div className="grid gap-3 lg:grid-cols-3">
          {PLANS.map((p) => (
            <div key={p.key} className={cx("rounded-xl border p-4", subscription.plan === p.key ? "border-brand-500 bg-brand-50/50 ring-1 ring-brand-500/20" : "border-ink-200")}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ink-900">{p.name}</p>
                {subscription.plan === p.key && <Badge tone="brand">current</Badge>}
              </div>
              <p className="mt-2 text-xl font-semibold tracking-tight text-ink-900">
                {p.price ? `${inr(p.price, true)}` : "Custom"}
                {p.price > 0 && <span className="text-xs font-normal text-ink-500"> /month</span>}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink-600">{p.blurb}</p>
              {p.minutes > 0 && (
                <p className="mt-2 text-[11px] text-ink-500">{p.minutes.toLocaleString("en-IN")} voice minutes · {p.seats} seats included</p>
              )}
              <Button
                className="mt-3 w-full"
                variant={subscription.plan === p.key ? "secondary" : "primary"}
                disabled={subscription.plan === p.key}
                onClick={() => notify("Connect a payment provider (Razorpay or Stripe) to complete plan changes in production")}
              >
                {subscription.plan === p.key ? "Current plan" : p.price ? "Switch to this plan" : "Talk to us"}
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-ink-50 p-3 text-[11px] leading-relaxed text-ink-500">
          <Lock size={13} className="mt-0.5 shrink-0" />
          Billing in this build records the plan, seat and minute limits and enforces them server-side. Wiring an actual
          payment provider is a contained change: the subscription row is already the single source of truth for what
          this hospital is allowed to do.
        </p>
      </Card>
    </>
  );
}
