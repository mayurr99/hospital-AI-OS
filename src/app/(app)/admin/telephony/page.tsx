"use client";

import { useState } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, StatTile, Table, Td, Th, Toggle, Tr } from "@/components/ui";
import { duration, inr } from "@/lib/utils";
import { Activity, CheckCircle2, Mic, PhoneForwarded, Radio, ServerCog, ShieldCheck, Volume2 } from "lucide-react";

export default function TelephonyPage() {
  const { can, notify, subscription, saveSetting, testConnection, settings } = useStore();
  const d = useOrgData();
  const t = d.telephony;

  /*
   * Every control on this page used to be uncontrolled: the inputs had
   * `defaultValue` and no `onChange`, and "Save" only raised a toast. Nothing
   * an administrator typed here was ever stored, and the page looked identical
   * whether or not they had saved. It is a real form now — one piece of state,
   * one write, and a busy label so nobody saves twice.
   */
  const stored = (settings.telephony ?? {}) as Record<string, unknown>;
  const [cfg, setCfg] = useState({
    aiNumber: t.aiNumber ?? "",
    fallbackNumber: t.fallbackNumber ?? "",
    sipTrunk: t.sipTrunk ?? "",
    concurrentChannels: t.concurrentChannels ?? 10,
    failover: stored.failover !== false,
    bargeIn: stored.bargeIn !== false,
    dtmf: stored.dtmf !== false,
    audioRetentionDays: Number(stored.audioRetentionDays ?? 180),
  });
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  /** Only enable Save when something has actually changed. */
  const dirty =
    cfg.aiNumber !== (t.aiNumber ?? "") ||
    cfg.fallbackNumber !== (t.fallbackNumber ?? "") ||
    cfg.sipTrunk !== (t.sipTrunk ?? "") ||
    Number(cfg.concurrentChannels) !== Number(t.concurrentChannels ?? 10) ||
    cfg.failover !== (stored.failover !== false) ||
    cfg.bargeIn !== (stored.bargeIn !== false) ||
    cfg.dtmf !== (stored.dtmf !== false) ||
    cfg.audioRetentionDays !== Number(stored.audioRetentionDays ?? 180);

  async function persist(extra?: { runTest?: boolean }) {
    setSaving(true);
    setTestResult(null);
    try {
      await saveSetting("telephony", { ...t, ...cfg, concurrentChannels: Number(cfg.concurrentChannels) });
      if (extra?.runTest) {
        const res = await testConnection("retell");
        setTestResult(`${res.ok ? "Reachable" : "Not reachable"} — ${res.detail}`);
        notify(res.ok ? "Saved. Voice provider reachable." : "Saved, but the voice provider did not answer.");
      } else {
        notify("Telephony settings saved");
      }
    } finally {
      setSaving(false);
    }
  }

  if (!can("telephony.configure")) return <Denied />;

  const minutes = Math.round(d.calls.reduce((s, c) => s + c.durationSeconds, 0) / 60);
  const spend = d.calls.reduce((s, c) => s + c.costRupees, 0);

  return (
    <>
      <PageHeader title="Telephony" subtitle="Numbers, SIP trunking, transfer routing, recording storage and failover behaviour" />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Connection" value={t.status} tone={t.status === "connected" ? "green" : "red"} icon={<Radio size={15} />} />
        <StatTile label="Concurrent channels" value={t.concurrentChannels} sub="peak usage 41%" icon={<Activity size={15} />} />
        <StatTile label="Minutes used" value={minutes.toLocaleString("en-IN")} sub={`of ${(subscription?.voiceMinutesCap ?? 0).toLocaleString("en-IN")} contracted`} icon={<Volume2 size={15} />} />
        <StatTile label="Voice spend" value={inr(Math.round(spend))} sub="blended rate ₹4.20 / min" tone="brand" icon={<PhoneForwarded size={15} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Numbers & trunk" icon={<ServerCog size={16} />} />
          <div className="space-y-3">
            <Field label="Provider" hint="Change this in Settings → Voice agent">
              <Input value={t.provider} readOnly className="bg-ink-50 text-ink-500" />
            </Field>
            <Field label="AI number" hint="The number the AI agent answers and dials from">
              <Input value={cfg.aiNumber} onChange={(e) => setCfg({ ...cfg, aiNumber: e.target.value })} placeholder="+91 20 4000 0000" />
            </Field>
            <Field label="Fallback number" hint="Where calls go if the AI service is unavailable">
              <Input value={cfg.fallbackNumber} onChange={(e) => setCfg({ ...cfg, fallbackNumber: e.target.value })} placeholder="+91 20 4000 9999" />
            </Field>
            <Field label="SIP trunk">
              <Input value={cfg.sipTrunk} onChange={(e) => setCfg({ ...cfg, sipTrunk: e.target.value })} />
            </Field>
            <Field label="Concurrent channels" hint="How many calls may run at the same time">
              <Input
                type="number" min={1} max={200} value={cfg.concurrentChannels}
                onChange={(e) => setCfg({ ...cfg, concurrentChannels: Number(e.target.value) })}
              />
            </Field>
            <div className="flex items-center gap-2">
              <Button variant="primary" size="sm" disabled={saving || !dirty} onClick={() => persist()}>
                {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
              </Button>
              <Button size="sm" disabled={saving} onClick={() => persist({ runTest: true })}>
                Save & test provider
              </Button>
            </div>
            {testResult && (
              <p className="rounded-lg bg-ink-50 p-2.5 text-[11px] text-ink-600">{testResult}</p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Transfer routing" subtitle="Where a human picks up" icon={<PhoneForwarded size={16} />} />
          <Table>
            <thead><tr><Th>Destination</Th><Th>Number</Th><Th>Hours</Th></tr></thead>
            <tbody>
              {t.transferDestinations.map((x) => (
                <Tr key={x.label}>
                  <Td className="font-medium text-ink-900">{x.label}</Td>
                  <Td className="tabular-nums text-xs">{x.number}</Td>
                  <Td className="text-xs">{x.hours}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-3 space-y-1 divide-y divide-ink-100">
            <Toggle label="Automatic failover" description="Route to the fallback number if the voice service is unreachable" checked={cfg.failover} onChange={(v) => setCfg({ ...cfg, failover: v })} />
            <Toggle label="Allow barge-in" description="Patient can interrupt the agent mid-sentence — makes calls feel natural" checked={cfg.bargeIn} onChange={(v) => setCfg({ ...cfg, bargeIn: v })} />
            <Toggle label="DTMF shortcuts" description="Press 0 at any point to reach a human" checked={cfg.dtmf} onChange={(v) => setCfg({ ...cfg, dtmf: v })} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Recording & storage" icon={<Mic size={16} />} />
          <div className="space-y-2 text-xs">
            <p className="flex justify-between gap-3"><span className="text-ink-500">Storage</span><span className="text-right font-medium text-ink-800">{t.recordingStorage}</span></p>
            <p className="flex justify-between"><span className="text-ink-500">Default policy</span><span className="font-medium text-ink-800">Record only with patient consent</span></p>
            <p className="flex justify-between"><span className="text-ink-500">Access</span><span className="font-medium text-ink-800">Permission-gated, every playback audited</span></p>
            <p className="flex justify-between"><span className="text-ink-500">Summary retention</span><span className="font-medium text-ink-800">Separate from audio retention</span></p>
          </div>
          <Field label="Default retention for audio" className="mt-3" hint="Saved with the rest of the telephony settings">
            <Select
              value={String(cfg.audioRetentionDays)}
              onChange={(e) => setCfg({ ...cfg, audioRetentionDays: Number(e.target.value) })}
            >
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="180">180 days</option>
              <option value="365">1 year</option>
            </Select>
          </Field>
          {dirty && (
            <Button className="mt-2" size="sm" variant="primary" disabled={saving} onClick={() => persist()}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          )}
          <p className="mt-3 rounded-lg bg-ink-50 p-3 text-[11px] leading-relaxed text-ink-500">
            <ShieldCheck size={11} className="mr-1 inline" />
            Structured clinical summaries can be retained far longer than raw audio — clinically useful, far less sensitive.
          </p>
        </Card>

        <Card>
          <CardHeader title="Failover behaviour" subtitle="What happens when something breaks" icon={<Activity size={16} />} />
          <Table>
            <thead><tr><Th>Failure</Th><Th>Safe behaviour</Th></tr></thead>
            <tbody>
              {[
                ["AI service unavailable", "Route to the normal IVR / human path immediately."],
                ["HIS unavailable", "Controlled degraded mode: reads served from cache, unsafe writes blocked and queued for reconciliation."],
                ["Voice provider failure", "Fail over to the secondary route or provider."],
                ["Invalid structured output", "Reject, retry with a constrained parser, then fall back to a human task."],
                ["Identity cannot be verified", "Do not reveal any protected information; offer a callback on the registered number."],
                ["Low conversation confidence", "Transfer to a human, or create a follow-up task if nobody is available."],
              ].map(([f, b]) => (
                <Tr key={f}>
                  <Td className="w-48 font-medium text-ink-900">{f}</Td>
                  <Td className="text-xs">{b}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      {/*
        This table previously showed "Interruptions", "ASR confidence" and
        "Audio" columns computed from the ROW INDEX — invented numbers presented
        as sampled telemetry. Per-call quality metrics have to come from the
        voice provider's API, which is not wired up, so the invented columns are
        gone and what remains is what the platform actually records.
      */}
      <Card className="mt-4">
        <CardHeader title="Recent calls" subtitle="What this platform records itself — per-call audio quality comes from the provider and is not connected yet" icon={<CheckCircle2 size={16} />} />
        <Table>
          <thead><tr><Th>Call</Th><Th>Language</Th><Th>Duration</Th><Th>Outcome</Th><Th>Cost</Th></tr></thead>
          <tbody>
            {d.calls.slice(0, 8).map((c) => (
              <Tr key={c.id}>
                <Td className="text-xs">{c.patientName}</Td>
                <Td><Badge>{c.language.toUpperCase()}</Badge></Td>
                <Td className="tabular-nums text-xs">{duration(c.durationSeconds)}</Td>
                <Td>
                  <Badge tone={c.status === "completed" ? "green" : c.status === "transferred" ? "amber" : c.status === "failed" ? "red" : "neutral"}>
                    {c.status.replace(/_/g, " ")}
                  </Badge>
                </Td>
                <Td className="tabular-nums text-xs">{inr(Math.round(c.costRupees))}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {!d.calls.length && (
          <p className="px-4 py-8 text-center text-sm text-ink-500">No calls placed yet.</p>
        )}
      </Card>
    </>
  );
}
