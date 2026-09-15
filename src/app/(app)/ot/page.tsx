"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, Modal, PageHeader, StatTile } from "@/components/ui";
import { cx, fmtTime } from "@/lib/utils";
import type { OTSlot } from "@/lib/types";
import { Activity, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Clock, Scissors, Zap } from "lucide-react";

export default function OtPage() {
  const { can, updateOt, notify, audit } = useStore();
  const d = useOrgData();
  const [dayOffset, setDayOffset] = useState(0);
  const [selected, setSelected] = useState<OTSlot | null>(null);

  const day = new Date();
  day.setDate(day.getDate() + dayOffset);
  const dayKey = day.toDateString();

  const daySlots = useMemo(
    () => d.otSlots.filter((s) => new Date(s.start).toDateString() === dayKey).sort((a, b) => (a.start < b.start ? -1 : 1)),
    [d.otSlots, dayKey],
  );
  const theatres = Array.from(new Set(d.otSlots.map((s) => s.theatre)));

  if (!can("ot.manage")) return <Denied />;

  const utilisation = Math.round((daySlots.reduce((s, x) => s + x.durationMinutes, 0) / Math.max(1, theatres.length * 11 * 60)) * 100);

  return (
    <>
      <PageHeader
        title="Operation theatre schedule"
        subtitle="Theatre utilisation, surgical checklist status and emergency slotting"
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Cases today" value={daySlots.length} icon={<Scissors size={15} />} tone="brand" />
        <StatTile label="Theatre utilisation" value={`${utilisation}%`} sub={`${theatres.length} theatres, 11h day`} icon={<Activity size={15} />} />
        <StatTile label="Emergency cases" value={daySlots.filter((s) => s.priority === "emergency").length} tone="red" icon={<Zap size={15} />} />
        <StatTile label="Checklist pending" value={daySlots.filter((s) => !s.checklistComplete && s.status === "scheduled").length} tone="amber" icon={<ClipboardCheck size={15} />} />
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 px-4 py-3">
          <Button size="sm" icon={<ChevronLeft size={14} />} onClick={() => setDayOffset((v) => v - 1)} />
          <Button size="sm" onClick={() => setDayOffset(0)}>Today</Button>
          <Button size="sm" icon={<ChevronRight size={14} />} onClick={() => setDayOffset((v) => v + 1)} />
          <p className="text-sm font-medium text-ink-900">
            {day.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>

        <div className="overflow-x-auto p-4">
          {daySlots.length === 0 ? (
            <EmptyState title="No cases scheduled" icon={<Scissors size={22} />} />
          ) : (
            <div className="flex min-w-max gap-3">
              {theatres.map((t) => {
                const slots = daySlots.filter((s) => s.theatre === t);
                return (
                  <div key={t} className="w-[250px] shrink-0">
                    <div className="mb-2 rounded-lg bg-ink-900 px-3 py-2">
                      <p className="text-xs font-semibold text-white">{t}</p>
                      <p className="text-[10px] text-ink-400">
                        {slots.length} case{slots.length !== 1 ? "s" : ""} · {slots.reduce((s, x) => s + x.durationMinutes, 0)} min booked
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      {slots.map((s) => {
                        const pat = d.patients.find((p) => p.id === s.patientId);
                        const surgeon = d.providers.find((p) => p.id === s.surgeonId);
                        return (
                          <button
                            key={s.id}
                            onClick={() => setSelected(s)}
                            className={cx(
                              "w-full rounded-lg border p-2.5 text-left text-xs transition hover:shadow",
                              s.status === "cancelled" ? "border-ink-200 bg-ink-50 opacity-60"
                                : s.status === "completed" ? "border-emerald-200 bg-emerald-50"
                                : s.status === "in_progress" ? "border-brand-400 bg-brand-50"
                                : s.priority === "emergency" ? "border-rose-300 bg-rose-50"
                                : "border-ink-200 bg-white",
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold tabular-nums text-ink-900">{fmtTime(s.start)}</span>
                              <span className="text-[10px] text-ink-500">{s.durationMinutes} min</span>
                            </div>
                            <p className="mt-1 font-medium text-ink-900">{s.procedure}</p>
                            <p className="truncate text-[11px] text-ink-500">{pat?.name}</p>
                            <p className="truncate text-[10px] text-ink-400">{surgeon?.name}</p>
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {s.priority === "emergency" && <Badge tone="red">emergency</Badge>}
                              <Badge tone={s.status === "completed" ? "green" : s.status === "in_progress" ? "brand" : "neutral"}>{s.status.replace("_", " ")}</Badge>
                              {!s.checklistComplete && s.status === "scheduled" && <Badge tone="amber">checklist</Badge>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Pre-op automation" subtitle="What the AI layer does around every scheduled case" icon={<Clock size={16} />} />
        <div className="grid gap-3 md:grid-cols-4">
          {[
            ["T-48 hours", "Confirmation call in the patient's language: arrival time, fasting instructions, what to bring."],
            ["T-24 hours", "WhatsApp reminder with the consent form link and pre-op checklist; unreachable patients escalate to the coordinator."],
            ["T-2 hours", "Attendant notified of theatre timing changes automatically if the list shifts."],
            ["Post-op day 2", "Automated recovery call: wound status, pain score, fever, mobility — red flags route to the surgeon."],
          ].map(([t, s]) => (
            <div key={t} className="rounded-lg border border-ink-200 p-3">
              <p className="text-xs font-semibold text-brand-700">{t}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-600">{s}</p>
            </div>
          ))}
        </div>
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.procedure ?? ""}
        subtitle={selected ? `${selected.theatre} · ${fmtTime(selected.start)} · ${selected.durationMinutes} minutes` : ""}
        footer={
          selected && (
            <>
              <Button onClick={() => setSelected(null)}>Close</Button>
              {!selected.checklistComplete && (
                <Button icon={<ClipboardCheck size={14} />} onClick={() => { updateOt(selected.id, { checklistComplete: true }); audit("ot.checklist.completed", selected.procedure); notify("WHO surgical safety checklist marked complete"); setSelected(null); }}>
                  Complete checklist
                </Button>
              )}
              {selected.status === "scheduled" && (
                <Button variant="primary" onClick={() => { updateOt(selected.id, { status: "in_progress" }); notify("Case marked in progress"); setSelected(null); }}>
                  Start case
                </Button>
              )}
              {selected.status === "in_progress" && (
                <Button variant="success" icon={<CheckCircle2 size={14} />} onClick={() => { updateOt(selected.id, { status: "completed" }); audit("ot.completed", selected.procedure); notify("Case completed — post-op follow-up call scheduled for day 2"); setSelected(null); }}>
                  Complete case
                </Button>
              )}
            </>
          )
        }
      >
        {selected && (
          <div className="space-y-2 text-sm">
            {[
              ["Patient", d.patients.find((p) => p.id === selected.patientId)?.name ?? "—"],
              ["MRN", d.patients.find((p) => p.id === selected.patientId)?.mrn ?? "—"],
              ["Surgeon", d.providers.find((p) => p.id === selected.surgeonId)?.name ?? "—"],
              ["Anaesthetist", selected.anaesthetist],
              ["Priority", selected.priority],
              ["Status", selected.status.replace("_", " ")],
              ["Safety checklist", selected.checklistComplete ? "Complete" : "Pending"],
            ].map(([k, v]) => (
              <p key={k} className="flex justify-between gap-2 border-b border-ink-100 pb-1.5 text-xs">
                <span className="text-ink-500">{k}</span>
                <span className="font-medium text-ink-800">{v}</span>
              </p>
            ))}
            {selected.patientId && (
              <Link href={`/patients/${selected.patientId}`} className="block pt-2">
                <Button size="sm" className="w-full">Open patient record</Button>
              </Link>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
