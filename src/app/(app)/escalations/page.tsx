"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { useSticky } from "@/lib/sticky";
import { Denied } from "@/components/AppShell";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Modal, PageHeader, StatTile, Tabs, Textarea } from "@/components/ui";
import { cx, fmtDateTime, relative } from "@/lib/utils";
import { AlertTriangle, BellRing, CheckCircle2, Clock, PhoneOutgoing, Shield, Siren, Timer } from "lucide-react";

type TabKey = "open" | "acknowledged" | "resolved" | "all";

export default function EscalationsPage() {
  const { can, acknowledgeEscalation, resolveEscalation, notify, audit, users, currentUser, dataReady } = useStore();
  const d = useOrgData();
  const [tab, setTab] = useSticky<TabKey>("escalations.tab", "open");
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const rows = useMemo(() => d.escalations.filter((e) => tab === "all" || e.status === tab), [d.escalations, tab]);

  const open = d.escalations.filter((e) => e.status === "open");
  const ack = d.escalations.filter((e) => e.status === "acknowledged");
  const resolved = d.escalations.filter((e) => e.status === "resolved");

  const slaBreaches = open.filter((e) => (Date.now() - new Date(e.raisedAt).getTime()) / 60000 > e.slaMinutes);
  const avgAck = useMemo(() => {
    const withAck = d.escalations.filter((e) => e.acknowledgedAt);
    if (!withAck.length) return 0;
    return Math.round(
      withAck.reduce((s, e) => s + Math.abs(new Date(e.acknowledgedAt!).getTime() - new Date(e.raisedAt).getTime()) / 60000, 0) / withAck.length,
    );
  }, [d.escalations]);

  if (!can("escalations.view")) return <Denied />;

  return (
    <>
      <PageHeader
        title="Clinical escalations"
        subtitle="Deterministic red flags raised by hospital-approved protocols — with SLA and acknowledgement tracking"
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open" value={open.length} sub={`${open.filter((e) => e.level === "red").length} red`} icon={<Siren size={15} />} tone={open.length ? "red" : "green"} />
        <StatTile label="SLA at risk" value={slaBreaches.length} sub="past configured response window" icon={<Timer size={15} />} tone={slaBreaches.length ? "amber" : "green"} />
        <StatTile label="Acknowledged" value={ack.length} sub="clinician has taken ownership" icon={<BellRing size={15} />} />
        <StatTile label="Avg acknowledgement" value={`${avgAck} min`} sub="across all escalations" icon={<Clock size={15} />} tone="green" />
      </div>

      <Card padded={false}>
        <div className="border-b border-ink-200 px-4 pt-2">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: "open", label: "Open", count: open.length },
              { key: "acknowledged", label: "Acknowledged", count: ack.length },
              { key: "resolved", label: "Resolved", count: resolved.length },
              { key: "all", label: "All", count: d.escalations.length },
            ]}
          />
        </div>

        <div className="space-y-3 p-4">
          {rows.length === 0 && <EmptyState loading={!dataReady} title="Nothing here" icon={<CheckCircle2 size={22} />} hint="No escalations in this state." />}
          {rows.map((e) => {
            const p = d.patients.find((x) => x.id === e.patientId);
            const call = d.calls.find((c) => c.id === e.callId);
            const assignee = users.find((u) => u.id === e.assignedTo);
            const minutesOpen = Math.round((Date.now() - new Date(e.raisedAt).getTime()) / 60000);
            const breach = e.status === "open" && minutesOpen > e.slaMinutes;
            return (
              <div
                key={e.id}
                className={cx(
                  "rounded-xl border p-4",
                  e.status === "resolved"
                    ? "border-ink-200 bg-white"
                    : e.level === "red"
                      ? "border-rose-300 bg-rose-50/50"
                      : "border-amber-300 bg-amber-50/40",
                )}
              >
                <div className="flex flex-wrap items-start gap-3">
                  <Avatar name={p?.name ?? "?"} size={40} hue={p?.gender === "F" ? 320 : 205} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/patients/${p?.id}`} className="text-sm font-semibold text-ink-900 hover:text-brand-700">{p?.name}</Link>
                      <Badge tone={e.level === "red" ? "red" : "amber"}>{e.level === "red" ? "RED — urgent" : "AMBER — review"}</Badge>
                      <Badge tone={e.status === "resolved" ? "green" : e.status === "acknowledged" ? "blue" : "red"}>{e.status}</Badge>
                      {breach && <Badge tone="red"><AlertTriangle size={10} /> SLA breached</Badge>}
                      <span className="text-[11px] text-ink-500">raised {relative(e.raisedAt)} · SLA {e.slaMinutes} min</span>
                    </div>
                    <p className="mt-1.5 text-sm font-medium text-ink-900">{e.trigger}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{e.detail}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-500">
                      <span>Assigned to <strong className="text-ink-800">{assignee?.name ?? "on-call team"}</strong></span>
                      {e.acknowledgedAt && <span>Acknowledged {relative(e.acknowledgedAt)}</span>}
                      {e.resolvedAt && <span>Resolved {relative(e.resolvedAt)}</span>}
                      {call && <span>From call {call.id} · {fmtDateTime(call.startedAt)}</span>}
                    </div>

                    {e.resolutionNote && (
                      <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900 ring-1 ring-emerald-200">
                        <strong>Resolution:</strong> {e.resolutionNote}
                      </p>
                    )}

                    {call && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {Object.entries(call.structured).slice(0, 6).map(([k, v]) => (
                          <span key={k} className="rounded-full bg-white px-2 py-0.5 text-[10px] text-ink-600 ring-1 ring-ink-200">
                            {k}: <strong className="text-ink-900">{v}</strong>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    {call && <Link href={`/calls?id=${call.id}`}><Button size="sm">Transcript</Button></Link>}
                    <Link href={`/live?patient=${e.patientId}`}><Button size="sm" icon={<PhoneOutgoing size={13} />}>Call patient</Button></Link>
                    {can("escalations.resolve") && e.status === "open" && (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          acknowledgeEscalation(e.id);
                          audit("escalation.acknowledged", `${e.id} by ${currentUser?.name} after ${minutesOpen} min`, "warning");
                          notify("Acknowledged — SLA clock stopped, ownership recorded");
                        }}
                      >
                        Acknowledge
                      </Button>
                    )}
                    {can("escalations.resolve") && e.status === "acknowledged" && (
                      <Button size="sm" variant="success" onClick={() => { setResolving(e.id); setNote(""); }}>Resolve</Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader title="How escalation works here" icon={<Shield size={15} />} />
        <div className="grid gap-3 text-xs leading-relaxed text-ink-600 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["1. Detect", "The deterministic protocol engine — not the language model — matches the patient's answer against hospital-approved red-flag rules."],
            ["2. Contain", "The routine conversation path is suspended immediately. The agent may not continue the questionnaire or offer advice."],
            ["3. Route", "A high-priority event alerts the configured destination (on-call clinician, care coordinator) and attempts a warm transfer."],
            ["4. Prove", "Who was alerted, who acknowledged, when, and what was said — all preserved in a tamper-evident audit trail."],
          ].map(([t, s]) => (
            <div key={t} className="rounded-lg border border-ink-200 p-3">
              <p className="mb-1 text-xs font-semibold text-ink-900">{t}</p>
              <p>{s}</p>
            </div>
          ))}
        </div>
      </Card>

      <Modal
        open={Boolean(resolving)}
        onClose={() => setResolving(null)}
        title="Resolve escalation"
        subtitle="The resolution note becomes part of the patient's permanent record"
        footer={
          <>
            <Button onClick={() => setResolving(null)}>Cancel</Button>
            <Button
              variant="success"
              disabled={!note.trim()}
              onClick={() => {
                resolveEscalation(resolving!, note);
                audit("escalation.resolved", `${resolving} by ${currentUser?.name}`, "warning");
                notify("Escalation resolved and recorded");
                setResolving(null);
              }}
            >
              Resolve
            </Button>
          </>
        }
      >
        <Textarea placeholder="What was done? e.g. Patient reviewed by on-call, ECG advised at nearest centre, stable." value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </>
  );
}
