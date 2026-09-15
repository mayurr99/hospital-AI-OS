"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { Denied, FeatureGate } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, StatTile, Table, Td, Th, Tr } from "@/components/ui";
import { cx, duration, fmtDateTime, relative } from "@/lib/utils";
import { AlertTriangle, Cloud, HardDrive, Lock, Mic, Play, Search, ShieldCheck, Timer } from "lucide-react";

interface Recording {
  id: string;
  callId: string;
  patientId: string | null;
  storageKind: "local" | "s3";
  storageKey: string;
  bytes: number;
  durationSeconds: number;
  mime: string;
  consent: boolean;
  retentionUntil: string | null;
  createdAt: string;
  transcript: { speaker: string; text: string; translation?: string; atSecond: number; flag?: string }[];
}

export default function RecordingsPage() {
  return (
    <FeatureGate feature="call_recording">
      <RecordingsInner />
    </FeatureGate>
  );
}

function RecordingsInner() {
  const { can, notify } = useStore();
  const d = useOrgData();
  const [data, setData] = useState<{ storage: { driver: string; describe: string; retentionDays: { audio: number }; verifiedAt: string | null }; recordings: Recording[] } | null>(null);
  const [open, setOpen] = useState<Recording | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [q, setQ] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetch("/api/recordings").then((r) => r.json()).then(setData).catch(() => {});
  }, []);

  if (!can("calls.view")) return <Denied />;
  if (!data) return <p className="text-sm text-ink-500">Loading recordings…</p>;

  const patientName = (id: string | null) => d.patients.find((p) => p.id === id)?.name ?? "Unknown patient";
  const rows = data.recordings.filter((r) => !q || patientName(r.patientId).toLowerCase().includes(q.toLowerCase()) || r.callId.includes(q));
  const totalBytes = data.recordings.reduce((s, r) => s + r.bytes, 0);
  const totalMinutes = Math.round(data.recordings.reduce((s, r) => s + r.durationSeconds, 0) / 60);

  async function play(rec: Recording) {
    setOpen(rec);
    setCurrentSec(0);
    if (!can("calls.listen")) {
      notify("Your role cannot play recordings — this attempt is recorded");
      return;
    }
    try {
      const res = await fetch(`/api/recordings/${rec.id}/audio`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        notify(err.error ?? "Recording unavailable");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.src = url;
        await audioRef.current.play().catch(() => {});
        setPlaying(true);
      }
      notify("Playback started — this access is written to the audit trail");
    } catch {
      notify("Could not load the recording");
    }
  }

  return (
    <>
      <PageHeader
        title="Call recordings"
        subtitle="Stored in your own storage, gated by consent and permission, and audited on every play"
      />

      <audio
        ref={audioRef}
        className="hidden"
        onTimeUpdate={(e) => setCurrentSec(Math.floor(e.currentTarget.currentTime))}
        onEnded={() => setPlaying(false)}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Recordings" value={data.recordings.length} icon={<Mic size={15} />} tone="brand" />
        <StatTile label="Audio retained" value={`${totalMinutes} min`} sub={`${(totalBytes / 1048576).toFixed(1)} MB`} icon={<HardDrive size={15} />} />
        <StatTile
          label="Storage"
          value={data.storage.driver === "s3" ? "S3 bucket" : "Local volume"}
          sub={data.storage.verifiedAt ? "verified" : "not yet verified"}
          icon={data.storage.driver === "s3" ? <Cloud size={15} /> : <HardDrive size={15} />}
          tone={data.storage.verifiedAt ? "green" : "amber"}
        />
        <StatTile label="Audio retention" value={`${data.storage.retentionDays.audio} days`} sub="then purged automatically" icon={<Timer size={15} />} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-xs text-ink-600">
        {data.storage.driver === "s3" ? <Cloud size={14} className="text-ink-400" /> : <HardDrive size={14} className="text-ink-400" />}
        <span className="font-medium text-ink-900">{data.storage.describe}</span>
        <Link href="/settings/storage" className="ml-auto font-medium text-brand-700 hover:underline">Change storage →</Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card padded={false}>
          <div className="border-b border-ink-200 px-4 py-3">
            <div className="relative max-w-sm">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <Input className="pl-9" placeholder="Patient name or call id…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          {rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Mic size={22} />}
                title="No recordings yet"
                hint="Run a call from the live console with a patient whose recording consent is granted, and it will appear here."
              />
            </div>
          ) : (
            <Table>
              <thead>
                <tr><Th>Patient</Th><Th>Duration</Th><Th>Size</Th><Th>Storage</Th><Th>Retention</Th><Th>Recorded</Th><Th /></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id} onClick={() => setOpen(r)}>
                    <Td>
                      <span className="block text-sm font-medium text-ink-900">{patientName(r.patientId)}</span>
                      <span className="block font-mono text-[10px] text-ink-400">{r.callId}</span>
                    </Td>
                    <Td className="tabular-nums text-xs">{duration(r.durationSeconds)}</Td>
                    <Td className="tabular-nums text-xs">{(r.bytes / 1024).toFixed(0)} KB</Td>
                    <Td><Badge tone={r.storageKind === "s3" ? "blue" : "neutral"}>{r.storageKind}</Badge></Td>
                    <Td className="text-xs text-ink-500">{r.retentionUntil ? relative(r.retentionUntil).replace(" ago", "") : "—"}</Td>
                    <Td className="text-xs text-ink-500">{relative(r.createdAt)}</Td>
                    <Td>
                      <Button size="sm" icon={<Play size={13} />} onClick={(e) => { e.stopPropagation(); play(r); }} disabled={!can("calls.listen")}>
                        Play
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          {open ? (
            <Card>
              <CardHeader
                title={patientName(open.patientId)}
                subtitle={`${duration(open.durationSeconds)} · ${fmtDateTime(open.createdAt)}`}
                icon={<Mic size={16} />}
              />
              {!can("calls.listen") ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <Lock size={14} className="mr-1 inline" />
                  Your role can see that this recording exists but cannot play it. The attempt has been logged.
                </div>
              ) : (
                <>
                  <div className="mb-3 flex items-center gap-3 rounded-lg bg-ink-900 px-3 py-2.5">
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Play size={13} />}
                      onClick={() => (playing ? (audioRef.current?.pause(), setPlaying(false)) : play(open))}
                    >
                      {playing ? "Pause" : "Play"}
                    </Button>
                    <div className="flex-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
                        <div className="h-full rounded-full bg-brand-400 transition-all" style={{ width: `${Math.min(100, (currentSec / Math.max(1, open.durationSeconds)) * 100)}%` }} />
                      </div>
                      <div className="mt-1 flex justify-between text-[10px] text-ink-400">
                        <span>{duration(currentSec)}</span>
                        <span>{duration(open.durationSeconds)}</span>
                      </div>
                    </div>
                  </div>

                  <p className="mb-2 text-xs font-semibold text-ink-900">Synced transcript</p>
                  <div className="max-h-[340px] space-y-1.5 overflow-y-auto">
                    {open.transcript.length === 0 && <p className="text-xs text-ink-400">No transcript stored for this recording.</p>}
                    {open.transcript.map((t, i) => (
                      <div
                        key={i}
                        className={cx(
                          "rounded-lg px-2.5 py-1.5 text-[11px] transition",
                          currentSec >= t.atSecond && currentSec < (open.transcript[i + 1]?.atSecond ?? 9999)
                            ? "bg-brand-100 ring-1 ring-brand-300"
                            : t.flag === "red"
                              ? "bg-rose-50"
                              : "bg-ink-50",
                        )}
                      >
                        <span className="mr-1.5 font-mono text-[9px] text-ink-400">{String(t.atSecond).padStart(2, "0")}s</span>
                        <span className={t.speaker === "system" ? "italic text-ink-500" : "text-ink-800"}>{t.text}</span>
                        {t.flag === "red" && <AlertTriangle size={10} className="ml-1 inline text-rose-600" />}
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="mt-3 space-y-1 border-t border-ink-100 pt-3 text-[11px]">
                {[
                  ["Storage", `${open.storageKind} · ${open.storageKey}`],
                  ["Size", `${(open.bytes / 1024).toFixed(0)} KB`],
                  ["Consent", open.consent ? "granted at time of call" : "not granted"],
                  ["Purge due", open.retentionUntil ? fmtDateTime(open.retentionUntil) : "—"],
                ].map(([k, v]) => (
                  <p key={k} className="flex justify-between gap-3">
                    <span className="text-ink-500">{k}</span>
                    <span className="break-all text-right font-medium text-ink-800">{v}</span>
                  </p>
                ))}
              </div>
              <Link href={`/calls?id=${open.callId}`} className="mt-3 block">
                <Button size="sm" className="w-full">Open the call record</Button>
              </Link>
            </Card>
          ) : (
            <Card>
              <EmptyState icon={<Play size={22} />} title="Select a recording" hint="The transcript follows the audio as it plays." />
            </Card>
          )}

          <Card>
            <CardHeader title="Recording governance" icon={<ShieldCheck size={16} />} />
            <div className="space-y-2 text-[11px] leading-relaxed text-ink-600">
              {[
                ["Consent decides, not the switch", "A recording is written only when that patient's recording consent is granted, whatever the global setting says."],
                ["Never linked from the bucket", "Audio is streamed through the server so a bucket URL can never leak into a browser history or a shared link."],
                ["Every play is a warning-level audit event", "Name, recording, and time — visible to the hospital in their own audit trail."],
                ["Audio expires before summaries", "Raw audio carries the shortest retention; the structured clinical summary long outlives it."],
              ].map(([t, s]) => (
                <div key={t} className="rounded-lg border border-ink-200 p-2.5">
                  <p className="mb-0.5 text-xs font-semibold text-ink-900">{t}</p>
                  <p>{s}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
