"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, PageHeader, StatTile, Tabs } from "@/components/ui";
import { cx, duration, relative, RISK_STYLES } from "@/lib/utils";
import {
  CalendarPlus, CheckCircle2, ClipboardList, Clock, PhoneCall, Siren, Stethoscope, UserCheck,
} from "lucide-react";

type TabKey = "urgent" | "review" | "callbacks" | "appointments" | "completed";

export default function DoctorCrmPage() {
  const { can, currentUser, reviewCall, notify, audit, updateTask, dataReady } = useStore();
  const d = useOrgData();
  const [tab, setTab] = useState<TabKey>("urgent");

  const isDoctor = currentUser?.role === "doctor";
  const mine = useMemo(() => {
    const pts = isDoctor ? d.patients.filter((p) => p.providerId === currentUser?.providerId) : d.patients;
    const ids = new Set(pts.map((p) => p.id));
    return {
      patients: pts,
      calls: d.calls.filter((c) => c.patientId && ids.has(c.patientId)),
      tasks: d.tasks.filter((t) => ids.has(t.patientId)),
      escalations: d.escalations.filter((e) => ids.has(e.patientId)),
    };
  }, [d, isDoctor, currentUser]);

  if (!can("queue.doctor")) return <Denied />;

  const urgent = mine.escalations.filter((e) => e.status !== "resolved");
  const review = mine.calls.filter((c) => c.reviewStatus === "pending");
  const callbacks = mine.tasks.filter((t) => t.queue === "callback" && t.status !== "done");
  const apptReq = mine.tasks.filter((t) => t.queue === "appointment" && t.status !== "done");
  const completed = mine.calls.filter((c) => c.reviewStatus === "reviewed" || c.reviewStatus === "not_required").slice(0, 25);

  return (
    <>
      <PageHeader
        title="Doctor review queue"
        subtitle={
          isDoctor
            ? "Exception-driven: only the patients who need you, with the routine ones summarised"
            : "All clinician review items across the hospital"
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Urgent" value={urgent.length} sub="red / amber escalations" icon={<Siren size={15} />} tone={urgent.length ? "red" : "green"} />
        <StatTile label="Awaiting your review" value={review.length} sub="structured follow-up results" icon={<Stethoscope size={15} />} tone="amber" />
        <StatTile label="Callback requests" value={callbacks.length} icon={<PhoneCall size={15} />} />
        <StatTile label="Routine completed" value={completed.length} sub="no action needed" icon={<CheckCircle2 size={15} />} tone="green" />
      </div>

      <Card padded={false}>
        <div className="border-b border-ink-200 px-4 pt-2">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: "urgent", label: "Urgent", count: urgent.length },
              { key: "review", label: "Review required", count: review.length },
              { key: "callbacks", label: "Callback requests", count: callbacks.length },
              { key: "appointments", label: "Appointment requests", count: apptReq.length },
              { key: "completed", label: "Routine completed", count: completed.length },
            ]}
          />
        </div>

        <div className="space-y-2.5 p-4">
          {tab === "urgent" &&
            (urgent.length === 0 ? (
              <EmptyState loading={!dataReady} title="Nothing urgent" hint="All escalations for your patients have been resolved." icon={<CheckCircle2 size={22} />} />
            ) : (
              urgent.map((e) => {
                const p = d.patients.find((x) => x.id === e.patientId);
                const call = d.calls.find((c) => c.id === e.callId);
                return (
                  <div key={e.id} className={cx("rounded-xl border p-4", e.level === "red" ? "border-rose-300 bg-rose-50/50" : "border-amber-300 bg-amber-50/40")}>
                    <div className="flex flex-wrap items-start gap-3">
                      <Avatar name={p?.name ?? "?"} size={38} hue={p?.gender === "F" ? 320 : 205} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/patients/${p?.id}`} className="text-sm font-semibold text-ink-900 hover:text-brand-700">{p?.name}</Link>
                          <Badge tone={e.level === "red" ? "red" : "amber"}>{e.level} flag</Badge>
                          <Badge tone={e.status === "acknowledged" ? "blue" : "red"}>{e.status}</Badge>
                          <span className="text-[11px] text-ink-500">· {relative(e.raisedAt)} · SLA {e.slaMinutes} min</span>
                        </div>
                        <p className="mt-1 text-sm font-medium text-ink-800">{e.trigger}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{e.detail}</p>
                        {call && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {Object.entries(call.structured).slice(0, 5).map(([k, v]) => (
                              <span key={k} className="rounded-full bg-white px-2 py-0.5 text-[10px] text-ink-600 ring-1 ring-ink-200">
                                {k}: <strong className="text-ink-900">{v}</strong>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {call && <Link href={`/calls?id=${call.id}`}><Button size="sm">Transcript</Button></Link>}
                        <Link href="/escalations"><Button size="sm" variant={e.level === "red" ? "danger" : "secondary"}>Handle</Button></Link>
                      </div>
                    </div>
                  </div>
                );
              })
            ))}

          {tab === "review" &&
            (review.length === 0 ? (
              <EmptyState loading={!dataReady} title="Review queue is clear" icon={<CheckCircle2 size={22} />} />
            ) : (
              review.map((c) => {
                const p = d.patients.find((x) => x.id === c.patientId);
                return (
                  <div key={c.id} className="rounded-xl border border-ink-200 p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <span className={cx("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", RISK_STYLES[c.risk].dot)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/patients/${p?.id}`} className="text-sm font-semibold text-ink-900 hover:text-brand-700">{c.patientName}</Link>
                          <span className="text-[11px] text-ink-400">{p?.diagnosis}</span>
                          <span className="ml-auto text-[11px] text-ink-400">{relative(c.startedAt)} · {duration(c.durationSeconds)}</span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-ink-600">{c.summary}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {Object.entries(c.structured).map(([k, v]) => (
                            <span key={k} className="rounded-full bg-ink-50 px-2 py-0.5 text-[10px] text-ink-600 ring-1 ring-ink-200">
                              {k}: <strong className="text-ink-900">{v}</strong>
                            </span>
                          ))}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <Button
                            size="sm"
                            variant="primary"
                            icon={<UserCheck size={13} />}
                            onClick={() => { reviewCall(c.id); audit("call.reviewed", `${c.id} — ${c.patientName}`); notify("Marked reviewed — patient returns to routine pathway"); }}
                          >
                            Mark reviewed
                          </Button>
                          <Link href={`/calls?id=${c.id}`}><Button size="sm">Full transcript</Button></Link>
                          <Link href={`/live?patient=${c.patientId}`}><Button size="sm" icon={<PhoneCall size={13} />}>Call patient</Button></Link>
                          <Link href={`/appointments?book=${c.patientId}`}><Button size="sm" icon={<CalendarPlus size={13} />}>Book review</Button></Link>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            ))}

          {(tab === "callbacks" || tab === "appointments") &&
            (() => {
              const list = tab === "callbacks" ? callbacks : apptReq;
              if (!list.length) return <EmptyState loading={!dataReady} title="Nothing in this queue" icon={<ClipboardList size={22} />} />;
              return list.map((t) => {
                const p = d.patients.find((x) => x.id === t.patientId);
                return (
                  <div key={t.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-ink-200 p-4">
                    <Avatar name={p?.name ?? "?"} size={34} hue={p?.gender === "F" ? 320 : 205} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/patients/${p?.id}`} className="text-sm font-semibold text-ink-900 hover:text-brand-700">{p?.name}</Link>
                        <Badge tone={t.priority === "high" ? "red" : "neutral"}>{t.priority}</Badge>
                        <span className="flex items-center gap-1 text-[11px] text-ink-400"><Clock size={11} /> {relative(t.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-ink-800">{t.title}</p>
                      <p className="text-xs text-ink-600">{t.detail}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <Link href={tab === "callbacks" ? `/live?patient=${t.patientId}` : `/appointments?book=${t.patientId}`}>
                        <Button size="sm" variant="primary">{tab === "callbacks" ? "Call now" : "Book slot"}</Button>
                      </Link>
                      <Button size="sm" onClick={() => { updateTask(t.id, { status: "done" }); notify("Task closed"); }}>Close</Button>
                    </div>
                  </div>
                );
              });
            })()}

          {tab === "completed" && (
            <>
              <p className="mb-2 text-xs text-ink-500">
                Routine calls where the protocol found no signal. Visible, but never interruptive.
              </p>
              {completed.map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded-lg border border-ink-200 px-3 py-2.5">
                  <span className={cx("h-2 w-2 rounded-full", RISK_STYLES[c.risk].dot)} />
                  <Link href={`/patients/${c.patientId}`} className="text-sm font-medium text-ink-900 hover:text-brand-700">{c.patientName}</Link>
                  <span className="truncate text-xs text-ink-500">{c.outcome}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-ink-400">{relative(c.startedAt)}</span>
                  <Link href={`/calls?id=${c.id}`}><Button size="sm" variant="ghost">View</Button></Link>
                </div>
              ))}
            </>
          )}
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Why this queue looks like this" icon={<Stethoscope size={15} />} />
        <p className="text-xs leading-relaxed text-ink-600">
          Doctors get a compressed, exception-driven view rather than hundreds of raw transcripts. The deterministic
          protocol engine decides what is urgent — not the language model. Every item carries provenance (agent version,
          protocol version, model version) so a clinical decision can always be traced back to the rule that produced it.
        </p>
      </Card>
    </>
  );
}
