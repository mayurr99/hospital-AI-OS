"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Toggle } from "@/components/ui";
import { cx, LANGUAGE_LABELS } from "@/lib/utils";
import type { LanguageCode } from "@/lib/types";
import {
  AlertTriangle, Bot, CheckCircle2, Copy, Languages, Loader2, Mic2, Play, RefreshCw, ShieldCheck, Volume2,
} from "lucide-react";

interface VoiceConfig {
  telephonyProvider: "retell" | "simulator";
  ttsProvider: "elevenlabs" | "retell" | "simulator";
  retell: { apiKey: string; agentId: string; fromNumber: string; webhookSecret: string; verifiedAt: string | null };
  elevenlabs: { apiKey: string; voiceId: string; voiceName: string; model: string; stability: number; similarity: number; verifiedAt: string | null };
  recordCalls: boolean;
  languages: LanguageCode[];
}

interface VoiceOption { id: string; name: string; labels?: string; previewUrl?: string }

export default function VoiceSettingsPage() {
  const { can, saveSetting, testConnection, notify, org } = useStore();
  const [cfg, setCfg] = useState<VoiceConfig | null>(null);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [simulatedVoices, setSimulatedVoices] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, { ok: boolean; detail: string; simulated?: boolean }>>({});
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetch("/api/settings/voice")
      .then((r) => r.json())
      .then((d) => setCfg(d.value))
      .catch(() => {});
    loadVoices();
  }, []);

  function loadVoices() {
    fetch("/api/voice/voices")
      .then((r) => r.json())
      .then((d) => {
        setVoices(d.voices ?? []);
        setAgents(d.agents ?? []);
        setSimulatedVoices(Boolean(d.simulated));
      })
      .catch(() => {});
  }

  if (!can("agents.configure")) return <Denied />;
  if (!cfg) return <p className="text-sm text-ink-500">Loading voice settings…</p>;

  const set = (patch: Partial<VoiceConfig>) => setCfg({ ...cfg, ...patch });

  async function save() {
    setSaving(true);
    await saveSetting("voice", cfg);
    setSaving(false);
    notify("Voice settings saved — keys are stored server-side and never returned to the browser");
    loadVoices();
  }

  async function runTest(target: "retell" | "elevenlabs") {
    setTesting(target);
    await saveSetting("voice", cfg);
    const r = await testConnection(target);
    setResult((prev) => ({ ...prev, [target]: r }));
    setTesting(null);
    if (r.ok) loadVoices();
  }

  async function preview() {
    setPreviewing(true);
    try {
      await saveSetting("voice", cfg);
      const res = await fetch("/api/voice/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "नमस्कार, मी रुग्णालयाची सहाय्यक बोलत आहे. तुमची तब्येत कशी आहे?" }),
      });
      const blob = await res.blob();
      const simulated = res.headers.get("X-Simulated") === "1";
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.src = url;
        await audioRef.current.play().catch(() => {});
      }
      notify(simulated ? "Played a simulated sample — add an ElevenLabs key for the real voice" : "Played a live ElevenLabs sample");
    } catch {
      notify("Could not generate a preview");
    } finally {
      setPreviewing(false);
    }
  }

  const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}/api/voice/webhook/retell` : "";

  return (
    <>
      <PageHeader
        title="Voice providers"
        subtitle="Bring your own Retell and ElevenLabs accounts — or rehearse the entire workflow on the built-in simulator"
        actions={<Button variant="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>}
      />

      <audio ref={audioRef} className="hidden" />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* mode */}
        <Card className="lg:col-span-2">
          <CardHeader title="How calls are placed" subtitle="Switch to live any time — nothing else in your setup changes" icon={<Bot size={16} />} />
          <div className="grid gap-3 md:grid-cols-2">
            <button
              onClick={() => set({ telephonyProvider: "simulator", ttsProvider: "simulator" })}
              className={cx("rounded-xl border p-4 text-left transition", cfg.telephonyProvider === "simulator" ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500/30" : "border-ink-200 hover:bg-ink-50")}
            >
              <p className="text-sm font-semibold text-ink-900">Built-in simulator</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-600">
                Conversations, transcripts, red-flag detection, recordings and escalation all work — generated on your own
                server with no vendor and no spend.
              </p>
              <Badge tone="green" className="mt-2">Active by default</Badge>
            </button>
            <button
              onClick={() => set({ telephonyProvider: "retell", ttsProvider: "elevenlabs" })}
              className={cx("rounded-xl border p-4 text-left transition", cfg.telephonyProvider === "retell" ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500/30" : "border-ink-200 hover:bg-ink-50")}
            >
              <p className="text-sm font-semibold text-ink-900">Retell + ElevenLabs (live)</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-600">
                Real inbound and outbound calls on your Retell number, spoken with your ElevenLabs voice. A provider
                failure is shown clearly so a simulated call can never be mistaken for a completed patient call.
              </p>
              <Badge tone="amber" className="mt-2">Requires your API keys</Badge>
            </button>
          </div>
        </Card>

        {/* retell */}
        <Card>
          <CardHeader
            title="Retell — telephony & conversation"
            subtitle="Outbound calling, inbound answering and live warm transfer"
            icon={<Bot size={16} />}
            action={cfg.retell.verifiedAt ? <Badge tone="green">verified</Badge> : <Badge tone="neutral">not verified</Badge>}
          />
          <div className="space-y-3">
            <Field label="API key" hint="Stored server-side. Shown masked once saved.">
              <Input
                type="text"
                value={cfg.retell.apiKey}
                onChange={(e) => set({ retell: { ...cfg.retell, apiKey: e.target.value } })}
                placeholder="key_xxxxxxxxxxxxxxxx"
              />
            </Field>
            <Field label="Agent">
              {agents.length ? (
                <Select value={cfg.retell.agentId} onChange={(e) => set({ retell: { ...cfg.retell, agentId: e.target.value } })}>
                  <option value="">Use the agent&apos;s default</option>
                  {agents.map((a) => (<option key={a.id} value={a.id}>{a.name} — {a.id.slice(0, 12)}…</option>))}
                </Select>
              ) : (
                <Input
                  value={cfg.retell.agentId}
                  onChange={(e) => set({ retell: { ...cfg.retell, agentId: e.target.value } })}
                  placeholder="agent_xxxxxxxx (test the key to list your agents)"
                />
              )}
            </Field>
            <Field label="Outbound caller ID" hint="A number purchased or imported in your Retell account">
              <Input value={cfg.retell.fromNumber} onChange={(e) => set({ retell: { ...cfg.retell, fromNumber: e.target.value } })} placeholder="+912040001099" />
            </Field>
            <Field label="Webhook signing secret">
              <Input value={cfg.retell.webhookSecret} onChange={(e) => set({ retell: { ...cfg.retell, webhookSecret: e.target.value } })} placeholder="whsec_…" />
            </Field>
            <div className="rounded-lg bg-ink-50 p-2.5">
              <p className="text-[11px] font-medium text-ink-600">Webhook URL to paste into Retell</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-white px-2 py-1 font-mono text-[11px] text-ink-700 ring-1 ring-ink-200">{webhookUrl}</code>
                <Button size="sm" icon={<Copy size={12} />} onClick={() => { navigator.clipboard?.writeText(webhookUrl); notify("Webhook URL copied"); }}>Copy</Button>
              </div>
            </div>
            <Button
              onClick={() => runTest("retell")}
              disabled={testing === "retell"}
              icon={testing === "retell" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            >
              {testing === "retell" ? "Testing…" : "Test connection"}
            </Button>
            {result.retell && (
              <p className={cx("flex items-start gap-2 rounded-lg px-3 py-2 text-xs", result.retell.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800")}>
                {result.retell.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
                {result.retell.detail}
              </p>
            )}
          </div>
        </Card>

        {/* elevenlabs */}
        <Card>
          <CardHeader
            title="ElevenLabs — speech synthesis"
            subtitle="The voice your patients actually hear"
            icon={<Mic2 size={16} />}
            action={cfg.elevenlabs.verifiedAt ? <Badge tone="green">verified</Badge> : <Badge tone="neutral">not verified</Badge>}
          />
          <div className="space-y-3">
            <Field label="API key">
              <Input
                value={cfg.elevenlabs.apiKey}
                onChange={(e) => set({ elevenlabs: { ...cfg.elevenlabs, apiKey: e.target.value } })}
                placeholder="sk_xxxxxxxxxxxxxxxx"
              />
            </Field>
            <Field label="Voice" hint={simulatedVoices ? "Showing built-in simulator voices — add a key to load your own library" : "Loaded live from your ElevenLabs library"}>
              <Select
                value={cfg.elevenlabs.voiceId}
                onChange={(e) => {
                  const v = voices.find((x) => x.id === e.target.value);
                  set({ elevenlabs: { ...cfg.elevenlabs, voiceId: e.target.value, voiceName: v?.name ?? "" } });
                }}
              >
                <option value="">Select a voice…</option>
                {voices.map((v) => (<option key={v.id} value={v.id}>{v.name}{v.labels ? ` — ${v.labels}` : ""}</option>))}
              </Select>
            </Field>
            <Field label="Model">
              <Select value={cfg.elevenlabs.model} onChange={(e) => set({ elevenlabs: { ...cfg.elevenlabs, model: e.target.value } })}>
                <option value="eleven_multilingual_v2">eleven_multilingual_v2 — best for Marathi/Hindi</option>
                <option value="eleven_turbo_v2_5">eleven_turbo_v2_5 — lowest latency</option>
                <option value="eleven_flash_v2_5">eleven_flash_v2_5 — fastest, telephony grade</option>
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`Stability — ${cfg.elevenlabs.stability.toFixed(2)}`} hint="Higher is steadier, lower is more expressive">
                <input
                  type="range" min={0} max={1} step={0.05} value={cfg.elevenlabs.stability}
                  onChange={(e) => set({ elevenlabs: { ...cfg.elevenlabs, stability: Number(e.target.value) } })}
                  className="w-full accent-brand-600"
                />
              </Field>
              <Field label={`Similarity — ${cfg.elevenlabs.similarity.toFixed(2)}`} hint="How closely it tracks the original voice">
                <input
                  type="range" min={0} max={1} step={0.05} value={cfg.elevenlabs.similarity}
                  onChange={(e) => set({ elevenlabs: { ...cfg.elevenlabs, similarity: Number(e.target.value) } })}
                  className="w-full accent-brand-600"
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => runTest("elevenlabs")} disabled={testing === "elevenlabs"} icon={testing === "elevenlabs" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}>
                {testing === "elevenlabs" ? "Testing…" : "Test connection"}
              </Button>
              <Button variant="primary" onClick={preview} disabled={previewing} icon={previewing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}>
                {previewing ? "Generating…" : "Preview the voice"}
              </Button>
            </div>
            {result.elevenlabs && (
              <p className={cx("flex items-start gap-2 rounded-lg px-3 py-2 text-xs", result.elevenlabs.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800")}>
                {result.elevenlabs.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
                {result.elevenlabs.detail}
              </p>
            )}
          </div>
        </Card>

        {/* languages + recording */}
        <Card className="lg:col-span-2">
          <CardHeader title="Conversation settings" icon={<Languages size={16} />} />
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-600">Languages the agent may use</p>
              <div className="flex flex-wrap gap-1.5">
                {(["mr", "hi", "en", "hinglish"] as LanguageCode[]).map((l) => {
                  const on = cfg.languages.includes(l);
                  return (
                    <button
                      key={l}
                      onClick={() => set({ languages: on ? cfg.languages.filter((x) => x !== l) : [...cfg.languages, l] })}
                      className={on ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-600"}
                    >
                      {LANGUAGE_LABELS[l]}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
                The language is detected on the call and the agent continues in it. Code-mixed Marathi-English is treated
                as normal speech, not as a recognition failure.
              </p>
            </div>
            <div className="rounded-lg border border-ink-200 px-3">
              <Toggle
                label="Record calls"
                description="Subject to each patient's recording consent — the consent engine overrides this switch"
                checked={cfg.recordCalls}
                onChange={(v) => set({ recordCalls: v })}
              />
              <div className="border-t border-ink-100 py-2">
                <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-500">
                  <ShieldCheck size={12} className="mt-0.5 shrink-0" />
                  Recordings go to the storage {org?.name ?? "your hospital"} configured, with their own retention period.
                  Playback is permission-gated and every play is audited.
                </p>
              </div>
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Why this is a provider interface, not an integration" icon={<Volume2 size={16} />} />
          <p className="text-xs leading-relaxed text-ink-600">
            Everything the platform needs from a voice vendor — place a call, transfer a call, list voices, synthesise
            speech — sits behind one interface. Retell and ElevenLabs are two implementations of it, the simulator is a
            third, and adding a fourth is a single file. That is what stops a vendor&apos;s pricing or availability from
            becoming your hospital&apos;s problem, and it is what lets a private-cloud or on-prem customer swap in their
            own speech stack without touching a single screen.
          </p>
        </Card>
      </div>
    </>
  );
}
