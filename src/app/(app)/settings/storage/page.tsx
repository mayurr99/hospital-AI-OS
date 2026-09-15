"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Toggle } from "@/components/ui";
import { cx, fmtDateTime } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Cloud, HardDrive, Loader2, Lock, RefreshCw, ShieldAlert, ShieldCheck, Timer } from "lucide-react";

interface StorageConfig {
  driver: "local" | "s3";
  local: { path: string };
  s3: { bucket: string; region: string; endpoint: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean };
  retentionDays: { audio: number; transcript: number; summary: number };
  encryptAtRest: boolean;
  verifiedAt: string | null;
}

const PRESETS = [
  { label: "AWS S3", endpoint: "", region: "ap-south-1", forcePathStyle: false },
  { label: "Cloudflare R2", endpoint: "https://<account>.r2.cloudflarestorage.com", region: "auto", forcePathStyle: true },
  { label: "MinIO (self-hosted)", endpoint: "https://minio.hospital.internal", region: "us-east-1", forcePathStyle: true },
  { label: "Wasabi", endpoint: "https://s3.ap-southeast-1.wasabisys.com", region: "ap-southeast-1", forcePathStyle: true },
];

export default function StorageSettingsPage() {
  const { can, saveSetting, testConnection, notify } = useStore();
  const [cfg, setCfg] = useState<StorageConfig | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  /** The server's real encryption state — null until a connection test reports it. */
  const [encryption, setEncryption] = useState<null | { configured: boolean; fingerprint: string; detail: string }>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/storage").then((r) => r.json()).then((d) => setCfg(d.value)).catch(() => {});
  }, []);

  if (!can("org.configure")) return <Denied />;
  if (!cfg) return <p className="text-sm text-ink-500">Loading storage settings…</p>;

  const set = (patch: Partial<StorageConfig>) => setCfg({ ...cfg, ...patch });

  async function save() {
    setSaving(true);
    await saveSetting("storage", cfg);
    setSaving(false);
    notify("Storage settings saved");
  }

  async function runTest() {
    setTesting(true);
    await saveSetting("storage", cfg);
    const r = await testConnection("storage") as ({ ok: boolean; detail: string; encryption?: { configured: boolean; fingerprint: string; detail: string } } | null);
    setResult(r);
    if (r?.encryption) setEncryption(r.encryption);
    setTesting(false);
    if (r?.ok) {
      const fresh = await fetch("/api/settings/storage").then((x) => x.json());
      setCfg(fresh.value);
    }
  }

  return (
    <>
      <PageHeader
        title="Storage & retention"
        subtitle="Where your call recordings and export bundles are written, and how long each kind of data is kept"
        actions={
          <>
            <Button onClick={runTest} disabled={testing} icon={testing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}>
              {testing ? "Testing…" : "Test connection"}
            </Button>
            <Button variant="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
          </>
        }
      />

      {result && (
        <div className={cx("mb-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm", result.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800")}>
          {result.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          <div>
            <p className="font-medium">{result.ok ? "Storage verified" : "Storage test failed"}</p>
            <p className="text-xs">{result.detail}</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader title="Where recordings live" subtitle="A real write, read-back and delete runs when you test — nothing is assumed" icon={<HardDrive size={16} />} />
          <div className="grid gap-3 md:grid-cols-2">
            <button
              onClick={() => set({ driver: "local" })}
              className={cx("rounded-xl border p-4 text-left transition", cfg.driver === "local" ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500/30" : "border-ink-200 hover:bg-ink-50")}
            >
              <HardDrive size={18} className="text-ink-500" />
              <p className="mt-2 text-sm font-semibold text-ink-900">Local volume</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-600">
                Audio stays on the server running the platform. Nothing leaves your premises — the right answer when a
                data-residency or network policy forbids cloud object storage.
              </p>
            </button>
            <button
              onClick={() => set({ driver: "s3" })}
              className={cx("rounded-xl border p-4 text-left transition", cfg.driver === "s3" ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500/30" : "border-ink-200 hover:bg-ink-50")}
            >
              <Cloud size={18} className="text-ink-500" />
              <p className="mt-2 text-sm font-semibold text-ink-900">S3-compatible bucket</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-600">
                Your own AWS S3, Cloudflare R2, MinIO or Wasabi bucket. You keep the keys, the lifecycle rules and the
                bill — we only write objects into it.
              </p>
            </button>
          </div>
          {cfg.verifiedAt && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700">
              <CheckCircle2 size={13} /> Last verified {fmtDateTime(cfg.verifiedAt)}
            </p>
          )}
        </Card>

        {cfg.driver === "local" ? (
          <Card>
            <CardHeader title="Local volume" icon={<HardDrive size={16} />} />
            <Field label="Storage path" hint="Relative paths resolve inside the platform's data directory; absolute paths are used as given">
              <Input value={cfg.local.path} onChange={(e) => set({ local: { path: e.target.value } })} placeholder=".data/recordings" />
            </Field>
            <p className="mt-3 rounded-lg bg-ink-50 p-3 text-[11px] leading-relaxed text-ink-600">
              Each hospital&apos;s recordings are written under their own tenant folder, so a shared deployment never mixes
              two hospitals&apos; audio in one directory. Back this path up with the same policy you use for your HIS.
            </p>
          </Card>
        ) : (
          <Card>
            <CardHeader title="S3-compatible bucket" subtitle="Credentials are stored server-side and returned masked" icon={<Cloud size={16} />} />
            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-xs font-medium text-ink-600">Quick presets</p>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      onClick={() => set({ s3: { ...cfg.s3, endpoint: p.endpoint, region: p.region, forcePathStyle: p.forcePathStyle } })}
                      className="rounded-full bg-ink-100 px-3 py-1 text-[11px] font-medium text-ink-700 hover:bg-ink-200"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <Field label="Bucket">
                <Input value={cfg.s3.bucket} onChange={(e) => set({ s3: { ...cfg.s3, bucket: e.target.value } })} placeholder="hospital-recordings" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Region"><Input value={cfg.s3.region} onChange={(e) => set({ s3: { ...cfg.s3, region: e.target.value } })} /></Field>
                <Field label="Endpoint" hint="Leave blank for AWS S3">
                  <Input value={cfg.s3.endpoint} onChange={(e) => set({ s3: { ...cfg.s3, endpoint: e.target.value } })} />
                </Field>
              </div>
              <Field label="Access key ID">
                <Input value={cfg.s3.accessKeyId} onChange={(e) => set({ s3: { ...cfg.s3, accessKeyId: e.target.value } })} />
              </Field>
              <Field label="Secret access key">
                <Input value={cfg.s3.secretAccessKey} onChange={(e) => set({ s3: { ...cfg.s3, secretAccessKey: e.target.value } })} placeholder="••••••••" />
              </Field>
              <div className="rounded-lg border border-ink-200 px-3">
                <Toggle
                  label="Force path-style addressing"
                  description="Required by MinIO and most non-AWS S3 implementations"
                  checked={cfg.s3.forcePathStyle}
                  onChange={(v) => set({ s3: { ...cfg.s3, forcePathStyle: v } })}
                />
              </div>
            </div>
          </Card>
        )}

        <Card>
          <CardHeader title="Retention" subtitle="Audio, transcripts and summaries age out separately" icon={<Timer size={16} />} />
          <div className="space-y-3">
            <Field label="Call audio (days)" hint="Raw recordings are the most sensitive and least reused">
              <Select value={cfg.retentionDays.audio} onChange={(e) => set({ retentionDays: { ...cfg.retentionDays, audio: Number(e.target.value) } })}>
                {[30, 90, 180, 365, 1095].map((d) => (<option key={d} value={d}>{d} days</option>))}
              </Select>
            </Field>
            <Field label="Transcripts (days)">
              <Select value={cfg.retentionDays.transcript} onChange={(e) => set({ retentionDays: { ...cfg.retentionDays, transcript: Number(e.target.value) } })}>
                {[90, 180, 365, 1095, 2555].map((d) => (<option key={d} value={d}>{d} days</option>))}
              </Select>
            </Field>
            <Field label="Clinical summaries (days)" hint="Clinically useful for years; far less sensitive than audio">
              <Select value={cfg.retentionDays.summary} onChange={(e) => set({ retentionDays: { ...cfg.retentionDays, summary: Number(e.target.value) } })}>
                {[365, 1095, 2555, 3650].map((d) => (<option key={d} value={d}>{d} days ({Math.round(d / 365)} years)</option>))}
              </Select>
            </Field>
            <div className="rounded-lg border border-ink-200 px-3">
              {/*
                This used to be a switch a hospital could tick, defaulting to
                on, that no code read — recordings and exports were written in
                plain text while somebody signed a compliance form on the
                strength of it. Encryption depends on a key held in the server's
                environment, which is not something a screen can set, so the
                screen now *reports* the state instead of pretending to control
                it. Press "Test connection" to refresh it.
              */}
              <div className="rounded-lg border border-ink-200 p-3">
                <div className="flex items-start gap-2">
                  {encryption?.configured ? (
                    <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                  ) : (
                    <ShieldAlert size={15} className="mt-0.5 shrink-0 text-amber-600" />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-ink-900">
                      Encryption at rest —{" "}
                      {encryption === null
                        ? "run a connection test to check"
                        : encryption.configured
                          ? `on (key ${encryption.fingerprint})`
                          : "off"}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">
                      {encryption?.detail ??
                        "Recordings and export bundles are encrypted only when the server has STORAGE_ENCRYPTION_KEY set."}
                    </p>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">
                      This covers recordings and export files. The patient database itself is <b>not</b> encrypted by
                      the application — that needs an encrypted volume or filesystem on the server, and no setting
                      here can provide it.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="How access is controlled" icon={<Lock size={16} />} />
          <div className="grid gap-3 text-xs leading-relaxed text-ink-600 md:grid-cols-4">
            {[
              ["Consent first", "A recording is only written if the patient's recording consent is granted — the switch in Voice settings cannot override it."],
              ["Permission-gated playback", "Only roles with the recording permission can play audio, and the file is streamed through the server, never linked directly from the bucket."],
              ["Every play audited", "Who played which recording, and when, is written to the audit trail as a warning-level event."],
              ["Retention enforced", "Each object carries its own expiry. Summaries survive audio, so clinical continuity does not depend on keeping sensitive recordings."],
            ].map(([t, s]) => (
              <div key={t} className="rounded-lg border border-ink-200 p-3">
                <p className="mb-1 text-xs font-semibold text-ink-900">{t}</p>
                <p>{s}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-ink-50 p-3 text-[11px] leading-relaxed text-ink-600">
            <Badge tone="brand">note</Badge>
            Changing the driver does not move existing objects. Recordings written to the previous store stay there and
            remain playable as long as that store is reachable.
          </p>
        </Card>
      </div>
    </>
  );
}
