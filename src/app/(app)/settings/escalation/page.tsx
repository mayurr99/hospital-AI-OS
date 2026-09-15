"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Toggle } from "@/components/ui";
import { cx } from "@/lib/utils";
import { AlertTriangle, Bell, Phone, PhoneForwarded, Plus, Siren, Timer, Trash2, Webhook } from "lucide-react";

interface EscalationConfig {
  mainLineNumber: string;
  transferMode: "warm" | "cold" | "conference";
  ringSeconds: number;
  onCall: { label: string; number: string; hours: string }[];
  fallbackNumber: string;
  notifyChannels: { sms: boolean; whatsapp: boolean; email: boolean; webhook: boolean };
  webhookUrl: string;
  slaMinutes: number;
  afterHoursNumber: string;
  autoForwardOnRed: boolean;
}

export default function EscalationSettingsPage() {
  const { can, saveSetting, notify } = useStore();
  const [cfg, setCfg] = useState<EscalationConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/escalation").then((r) => r.json()).then((d) => setCfg(d.value)).catch(() => {});
  }, []);

  if (!can("protocols.configure")) return <Denied />;
  if (!cfg) return <p className="text-sm text-ink-500">Loading escalation settings…</p>;

  const set = (patch: Partial<EscalationConfig>) => setCfg({ ...cfg, ...patch });

  async function save() {
    setSaving(true);
    await saveSetting("escalation", cfg);
    setSaving(false);
    notify("Escalation routing saved — it takes effect on the next red flag");
  }

  const configured = Boolean(cfg.mainLineNumber);

  return (
    <>
      <PageHeader
        title="Escalation routing"
        subtitle="What happens the moment a follow-up call hits a red flag"
        actions={<Button variant="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save routing"}</Button>}
      />

      {!configured && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">No main line configured</p>
            <p className="text-xs">
              Critical follow-up calls cannot be forwarded until you set a number here. The platform will refuse to start
              a protocol-driven call rather than risk a red flag with nowhere to go.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader title="The critical path" subtitle="Each step runs in order, and every one is recorded" icon={<Siren size={16} />} />
          <div className="grid gap-3 md:grid-cols-5">
            {[
              ["Red flag matched", "The deterministic protocol engine, not the model, decides this."],
              ["Routine flow stops", "No further questions, no advice, no improvisation."],
              ["Live call forwarded", `${cfg.transferMode} transfer to ${cfg.mainLineNumber || "your main line"}.`],
              ["Escalation opened", `SLA ${cfg.slaMinutes} minutes, assigned and acknowledged by a named person.`],
              ["Never dropped", "If no line answers, a high-priority callback task is raised for a human."],
            ].map(([t, s], i) => (
              <div key={t} className="rounded-lg border border-ink-200 p-3">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-rose-600 text-[10px] font-bold text-white">{i + 1}</span>
                  <p className="text-xs font-semibold text-ink-900">{t}</p>
                </div>
                <p className="text-[11px] leading-relaxed text-ink-600">{s}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Main line" subtitle="Where a critical call is handed over" icon={<PhoneForwarded size={16} />} />
          <div className="space-y-3">
            <Field label="Main line number" hint="Usually the on-call clinician desk or the hospital's emergency extension">
              <Input value={cfg.mainLineNumber} onChange={(e) => set({ mainLineNumber: e.target.value })} placeholder="+91 20 4000 1099" />
            </Field>
            <Field label="After-hours number" hint="Used outside 08:00–20:00; falls back to the main line when blank">
              <Input value={cfg.afterHoursNumber} onChange={(e) => set({ afterHoursNumber: e.target.value })} placeholder="+91 98200 00000" />
            </Field>
            <Field label="Fallback number" hint="Tried if the main line does not accept the transfer">
              <Input value={cfg.fallbackNumber} onChange={(e) => set({ fallbackNumber: e.target.value })} />
            </Field>
            <Field label="Transfer mode">
              <Select value={cfg.transferMode} onChange={(e) => set({ transferMode: e.target.value as EscalationConfig["transferMode"] })}>
                <option value="warm">Warm — the agent briefs the clinician, then steps back</option>
                <option value="cold">Cold — the patient is transferred immediately</option>
                <option value="conference">Conference — clinician joins with the agent still on the line</option>
              </Select>
            </Field>
            <Field label={`Ring for ${cfg.ringSeconds}s before falling back`}>
              <input
                type="range" min={10} max={60} step={5} value={cfg.ringSeconds}
                onChange={(e) => set({ ringSeconds: Number(e.target.value) })}
                className="w-full accent-brand-600"
              />
            </Field>
            <div className="rounded-lg border border-ink-200 px-3">
              <Toggle
                label="Forward automatically on a red flag"
                description="Turn this off only if your clinical team prefers a callback instead of a live handover"
                checked={cfg.autoForwardOnRed}
                onChange={(v) => set({ autoForwardOnRed: v })}
              />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="On-call rota"
            subtitle="Tried in order after the main line"
            icon={<Phone size={16} />}
            action={
              <Button size="sm" icon={<Plus size={13} />} onClick={() => set({ onCall: [...cfg.onCall, { label: "", number: "", hours: "24×7" }] })}>
                Add
              </Button>
            }
          />
          {cfg.onCall.length === 0 ? (
            <p className="rounded-lg bg-ink-50 p-3 text-xs text-ink-500">
              No rota entries. The main line and fallback number are used on their own.
            </p>
          ) : (
            <div className="space-y-2">
              {cfg.onCall.map((o, i) => (
                <div key={i} className="grid gap-2 rounded-lg border border-ink-200 p-2.5 sm:grid-cols-[1.2fr_1.2fr_0.9fr_auto]">
                  <Input placeholder="Cardiology on-call" value={o.label} onChange={(e) => { const n = [...cfg.onCall]; n[i] = { ...o, label: e.target.value }; set({ onCall: n }); }} />
                  <Input placeholder="+91 …" value={o.number} onChange={(e) => { const n = [...cfg.onCall]; n[i] = { ...o, number: e.target.value }; set({ onCall: n }); }} />
                  <Input placeholder="24×7" value={o.hours} onChange={(e) => { const n = [...cfg.onCall]; n[i] = { ...o, hours: e.target.value }; set({ onCall: n }); }} />
                  <Button size="sm" variant="ghost" onClick={() => set({ onCall: cfg.onCall.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4">
            <CardHeader title="Alerts alongside the transfer" icon={<Bell size={16} />} />
            <div className="grid gap-1.5 sm:grid-cols-2">
              {([
                ["sms", "SMS to the on-call"],
                ["whatsapp", "WhatsApp to the care team"],
                ["email", "Email to the department"],
                ["webhook", "Webhook to your paging system"],
              ] as const).map(([key, label]) => {
                const on = cfg.notifyChannels[key];
                return (
                  <button
                    key={key}
                    onClick={() => set({ notifyChannels: { ...cfg.notifyChannels, [key]: !on } })}
                    className={cx("flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs", on ? "border-emerald-200 bg-emerald-50" : "border-ink-200 hover:bg-ink-50")}
                  >
                    <span className={cx("h-3.5 w-3.5 shrink-0 rounded", on ? "bg-emerald-500" : "bg-ink-200")} />
                    <span className="text-ink-700">{label}</span>
                  </button>
                );
              })}
            </div>
            {cfg.notifyChannels.webhook && (
              <Field label="Webhook URL" className="mt-3">
                <Input value={cfg.webhookUrl} onChange={(e) => set({ webhookUrl: e.target.value })} placeholder="https://paging.hospital.internal/hooks/critical" />
              </Field>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Acknowledgement SLA" subtitle="How long a named clinician has to take ownership" icon={<Timer size={16} />} />
          <div className="flex flex-wrap items-center gap-3">
            {[5, 10, 15, 30, 60].map((m) => (
              <button
                key={m}
                onClick={() => set({ slaMinutes: m })}
                className={cx("rounded-xl border px-4 py-2.5 text-sm font-medium transition", cfg.slaMinutes === m ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ink-200 text-ink-600 hover:bg-ink-50")}
              >
                {m} minutes
              </button>
            ))}
            <Badge tone={cfg.slaMinutes <= 15 ? "green" : "amber"} className="ml-2">
              {cfg.slaMinutes <= 15 ? "recommended for cardiac and post-op pathways" : "acceptable for lower-acuity pathways"}
            </Badge>
          </div>
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-ink-50 p-3 text-[11px] leading-relaxed text-ink-600">
            <Webhook size={13} className="mt-0.5 shrink-0 text-ink-400" />
            Breaching the SLA does not silently fail. The escalation is flagged on the queue, the breach is visible in
            the audit trail, and the acknowledgement time of every escalation is reported in Analytics so your clinical
            governance committee can see the real numbers rather than an assurance.
          </p>
        </Card>
      </div>
    </>
  );
}
