"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Progress, Select, StatTile, Table, Td, Textarea, Th, Tr } from "@/components/ui";
import { fmtDate, inr, pct, relative } from "@/lib/utils";
import { AlertTriangle, ArrowUpRight, Building2, Globe2, IndianRupee, Lock, Radio, Users } from "lucide-react";
import { SUBSCRIPTION_PLAN_KEYS } from "@/lib/plans";

interface Tenant {
  id: string;
  name: string;
  shortName: string;
  city: string;
  status: string;
  plan: string;
  deployment: string;
  accentColor: string;
  logoInitials: string;
  isDemo: boolean;
  createdAt: string;
  users: number;
  patients: number;
  calls: number;
  onboardingComplete: boolean;
  subscription: {
    plan: string;
    status: string;
    trialEndsAt: string | null;
    trialDaysLeft: number | null;
    seats: number;
    voiceMinutesCap: number;
    voiceMinutesUsed: number;
    monthlyFee: number;
    features: string[];
  } | null;
  services: { voice: string; storage: string };
}

interface Feature { key: string; label: string; group: string }

export default function PlatformPage() {
  const { can, setActiveOrg, notify } = useStore();
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [entering, setEntering] = useState<Tenant | null>(null);
  const [managing, setManaging] = useState<Tenant | null>(null);
  const [availableFeatures, setAvailableFeatures] = useState<Feature[]>([]);
  const [saving, setSaving] = useState(false);
  const [justification, setJustification] = useState("");

  useEffect(() => {
    fetch("/api/platform/tenants")
      .then((r) => r.json())
      .then((d) => { setTenants(d.tenants ?? []); setAvailableFeatures(d.availableFeatures ?? []); })
      .catch(() => setTenants([]))
      .finally(() => setLoading(false));
  }, []);

  if (!can("tenant.manage")) return <Denied />;

  const mrr = tenants.reduce((s, t) => s + (t.subscription?.monthlyFee ?? 0), 0);
  const minutesUsed = tenants.reduce((s, t) => s + (t.subscription?.voiceMinutesUsed ?? 0), 0);
  const minutesCap = tenants.reduce((s, t) => s + (t.subscription?.voiceMinutesCap ?? 0), 0);
  const trials = tenants.filter((t) => t.subscription?.status === "trialing");
  const expired = tenants.filter((t) => t.subscription?.status === "trial_expired");

  return (
    <>
      <PageHeader
        title="Platform tenant console"
        subtitle="Every hospital on the platform — signups, trials, usage, onboarding progress and commercial health"
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Hospitals" value={tenants.length} sub={`${tenants.filter((t) => !t.isDemo).length} self-signup`} icon={<Building2 size={15} />} tone="brand" />
        <StatTile label="Monthly recurring" value={inr(mrr, true)} icon={<IndianRupee size={15} />} tone="green" />
        <StatTile label="Active trials" value={trials.length} sub={`${expired.length} expired`} icon={<AlertTriangle size={15} />} tone={trials.length ? "amber" : "neutral"} />
        <StatTile label="Voice minutes" value={minutesUsed.toLocaleString("en-IN")} sub={`${pct(minutesUsed, minutesCap)} of contracted`} icon={<Radio size={15} />} />
        <StatTile label="Staff accounts" value={tenants.reduce((s, t) => s + t.users, 0)} icon={<Users size={15} />} />
      </div>

      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader title="Tenants" subtitle="Signup, onboarding state and usage per hospital" icon={<Globe2 size={16} />} />
        </div>
        {loading ? (
          <p className="px-5 pb-5 text-sm text-ink-500">Loading tenants…</p>
        ) : tenants.length === 0 ? (
          <div className="p-5"><EmptyState title="No tenants yet" /></div>
        ) : (
          <Table>
            <thead>
              <tr><Th>Hospital</Th><Th>Plan</Th><Th>Subscription</Th><Th>Services</Th><Th>Voice usage</Th><Th>Data</Th><Th>Joined</Th><Th /></tr>
            </thead>
            <tbody>
              {tenants.map((t) => {
                const sub = t.subscription;
                const usage = sub && sub.voiceMinutesCap ? Math.round((sub.voiceMinutesUsed / sub.voiceMinutesCap) * 100) : 0;
                return (
                  <Tr key={t.id}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[11px] font-bold text-white" style={{ background: t.accentColor }}>
                          {t.logoInitials}
                        </span>
                        <span>
                          <span className="block text-sm font-medium text-ink-900">{t.name}</span>
                          <span className="block text-[11px] text-ink-400">
                            {t.city || "—"} · {t.users} users{t.isDemo ? " · demo tenant" : ""}
                          </span>
                        </span>
                      </div>
                    </Td>
                    <Td><Badge tone={t.plan === "enterprise" ? "purple" : t.plan === "trial" ? "amber" : "brand"}>{t.plan}</Badge></Td>
                    <Td>
                      {sub?.status === "trialing" ? (
                        <Badge tone="amber">trial · {sub.trialDaysLeft} day{sub.trialDaysLeft === 1 ? "" : "s"} left</Badge>
                      ) : sub?.status === "trial_expired" ? (
                        <Badge tone="red">trial expired</Badge>
                      ) : (
                        <Badge tone="green">{sub?.status ?? "active"}</Badge>
                      )}
                      {sub && sub.monthlyFee > 0 && <span className="mt-0.5 block text-[11px] text-ink-500">{inr(sub.monthlyFee, true)}/mo</span>}
                    </Td>
                    <Td className="text-xs text-ink-600">
                      <Badge tone={t.onboardingComplete ? "green" : "amber"}>{t.onboardingComplete ? "configured" : "setup pending"}</Badge>
                      <span className="mt-1 block">Voice: {t.services.voice}</span>
                      <span className="block">Storage: {t.services.storage}</span>
                      {sub && <span className="block text-[11px] text-ink-400">{sub.features.length} services enabled</span>}
                    </Td>
                    <Td className="w-40">
                      <div className="flex items-center gap-2">
                        <div className="w-20"><Progress value={usage} tone={usage > 90 ? "red" : usage > 75 ? "amber" : "brand"} /></div>
                        <span className="text-[11px] tabular-nums text-ink-600">{usage}%</span>
                      </div>
                      <span className="text-[10px] text-ink-400">
                        {(sub?.voiceMinutesUsed ?? 0).toLocaleString("en-IN")} of {(sub?.voiceMinutesCap ?? 0).toLocaleString("en-IN")} min
                      </span>
                    </Td>
                    <Td className="text-xs text-ink-600">
                      {t.patients} patients<br />
                      {t.calls} calls
                    </Td>
                    <Td className="text-xs text-ink-500">{fmtDate(t.createdAt)}<span className="block text-[10px] text-ink-400">{relative(t.createdAt)}</span></Td>
                    <Td>
                      <div className="flex flex-col gap-1.5">
                        <Button size="sm" onClick={() => setManaging(structuredClone(t))}>Manage plan</Button>
                        <Button size="sm" icon={<ArrowUpRight size={13} />} onClick={() => { setEntering(t); setJustification(""); }}>Open workspace</Button>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={Boolean(managing)}
        onClose={() => setManaging(null)}
        title="Hospital subscription"
        subtitle={managing?.name}
        footer={<>
          <Button onClick={() => setManaging(null)}>Cancel</Button>
          <Button variant="primary" disabled={saving} onClick={async () => {
            if (!managing?.subscription) return;
            setSaving(true);
            try {
              const res = await fetch("/api/platform/tenants", {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  orgId: managing.id, plan: managing.subscription.plan,
                  subscriptionStatus: managing.subscription.status, orgStatus: managing.status,
                  seats: managing.subscription.seats, voiceMinutesCap: managing.subscription.voiceMinutesCap,
                  monthlyFee: managing.subscription.monthlyFee, features: managing.subscription.features,
                }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error ?? "Could not save subscription");
              setTenants((rows) => rows.map((t) => t.id === managing.id ? managing : t));
              notify(`Updated ${managing.shortName} subscription`);
              setManaging(null);
            } catch (e) { notify(e instanceof Error ? e.message : "Could not save subscription"); }
            finally { setSaving(false); }
          }}>{saving ? "Saving…" : "Save subscription"}</Button>
        </>}
      >
        {managing?.subscription && <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Plan"><Select value={managing.subscription.plan} onChange={(e) => setManaging({ ...managing, plan: e.target.value, subscription: { ...managing.subscription!, plan: e.target.value } })}>
              {SUBSCRIPTION_PLAN_KEYS.map((v) => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}
            </Select></Field>
            <Field label="Billing status"><Select value={managing.subscription.status} onChange={(e) => setManaging({ ...managing, subscription: { ...managing.subscription!, status: e.target.value } })}>
              {['trialing','active','past_due','suspended','cancelled'].map((v) => <option key={v} value={v}>{v.replaceAll('_',' ')}</option>)}
            </Select></Field>
            <Field label="Hospital status"><Select value={managing.status} onChange={(e) => setManaging({ ...managing, status: e.target.value })}>
              {['trial','active','suspended'].map((v) => <option key={v} value={v}>{v}</option>)}
            </Select></Field>
            <Field label="Seats"><Input type="number" min={1} value={managing.subscription.seats} onChange={(e) => setManaging({ ...managing, subscription: { ...managing.subscription!, seats: Number(e.target.value) } })} /></Field>
            <Field label="Voice minutes"><Input type="number" min={0} value={managing.subscription.voiceMinutesCap} onChange={(e) => setManaging({ ...managing, subscription: { ...managing.subscription!, voiceMinutesCap: Number(e.target.value) } })} /></Field>
            <Field label="Monthly fee (₹)"><Input type="number" min={0} value={managing.subscription.monthlyFee} onChange={(e) => setManaging({ ...managing, subscription: { ...managing.subscription!, monthlyFee: Number(e.target.value) } })} /></Field>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-ink-700">Enabled services</p>
            <div className="grid max-h-56 gap-2 overflow-auto rounded-lg border border-ink-200 p-3 sm:grid-cols-2">
              {availableFeatures.map((f) => <label key={f.key} className="flex items-start gap-2 text-xs text-ink-700">
                <input type="checkbox" className="mt-0.5" checked={managing.subscription!.features.includes(f.key)} onChange={(e) => {
                  const current = managing.subscription!.features;
                  const features = e.target.checked ? [...current, f.key] : current.filter((x) => x !== f.key);
                  setManaging({ ...managing, subscription: { ...managing.subscription!, features } });
                }} />
                <span><b className="font-medium">{f.label}</b><span className="block text-ink-400">{f.group}</span></span>
              </label>)}
            </div>
          </div>
        </div>}
      </Modal>

      <Card className="mt-4">
        <CardHeader title="Platform access governance" icon={<Lock size={16} />} />
        <div className="grid gap-3 text-xs leading-relaxed text-ink-600 md:grid-cols-2 xl:grid-cols-4">
          {[
            ["Access is justified and logged", "Opening a hospital workspace requires a written reason and raises a critical audit event visible inside that hospital's own audit trail."],
            ["Tenant isolation is server-side", "Every data route derives the tenant from the session, never from the request body. There is no endpoint that returns two hospitals' records."],
            ["Secrets never leave the server", "Retell and ElevenLabs keys and S3 secrets are stored server-side and returned to the browser masked."],
            ["Storage belongs to the hospital", "Each tenant chooses local disk or their own S3 bucket; recordings and exports are written through their driver, not a shared pool."],
          ].map(([t, s]) => (
            <div key={t} className="rounded-lg border border-ink-200 p-3">
              <p className="mb-0.5 text-xs font-semibold text-ink-900">{t}</p>
              <p>{s}</p>
            </div>
          ))}
        </div>
      </Card>

      <Modal
        open={Boolean(entering)}
        onClose={() => setEntering(null)}
        title="Open hospital workspace"
        subtitle={entering?.name}
        footer={
          <>
            <Button onClick={() => setEntering(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={justification.trim().length < 8}
              onClick={async () => {
                await setActiveOrg(entering!.id, justification);
                notify(`Opened ${entering!.shortName} — access logged and visible to the hospital`);
                setEntering(null);
                router.push("/dashboard");
              }}
            >
              Open workspace
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm leading-relaxed text-ink-600">
          Entering a customer workspace is a critical, audited event. The hospital sees this access in their own audit
          trail, including your name and the justification you give here.
        </p>
        <Textarea
          placeholder="Reason for access — e.g. investigating the discharge webhook failure raised in ticket #4821"
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
        />
      </Modal>
    </>
  );
}
