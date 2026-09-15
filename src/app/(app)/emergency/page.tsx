"use client";

import Link from "next/link";
import { useState } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, Modal, PageHeader, Select, StatTile } from "@/components/ui";
import { cx, relative } from "@/lib/utils";
import type { EmergencyCase } from "@/lib/types";
import { Activity, Ambulance, Clock, HeartPulse, Radio, Siren, Stethoscope, Thermometer } from "lucide-react";

const TRIAGE: Record<number, { label: string; cls: string; target: string }> = {
  1: { label: "1 · Resuscitation", cls: "border-rose-400 bg-rose-50 text-rose-900", target: "Immediate" },
  2: { label: "2 · Emergent", cls: "border-orange-400 bg-orange-50 text-orange-900", target: "≤ 10 min" },
  3: { label: "3 · Urgent", cls: "border-amber-400 bg-amber-50 text-amber-900", target: "≤ 30 min" },
  4: { label: "4 · Less urgent", cls: "border-sky-400 bg-sky-50 text-sky-900", target: "≤ 60 min" },
  5: { label: "5 · Non-urgent", cls: "border-emerald-400 bg-emerald-50 text-emerald-900", target: "≤ 120 min" },
};

export default function EmergencyPage() {
  const { can, updateEmergency, notify, audit, dataReady } = useStore();
  const d = useOrgData();
  const [filter, setFilter] = useState("active");
  const [open, setOpen] = useState<EmergencyCase | null>(null);

  if (!can("emergency.manage")) return <Denied />;

  const cases = d.emergencyCases
    .filter((c) => (filter === "active" ? c.status === "waiting" || c.status === "in_treatment" : filter === "all" ? true : c.status === filter))
    .sort((a, b) => a.triage - b.triage || (a.arrivedAt < b.arrivedAt ? -1 : 1));

  const incoming = d.emergencyCases.filter((c) => c.ambulanceEta !== undefined);
  const waiting = d.emergencyCases.filter((c) => c.status === "waiting");

  return (
    <>
      <PageHeader title="Emergency & triage" subtitle="Live ED board, triage priority and inbound ambulance tracking" />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Waiting" value={waiting.length} tone={waiting.length > 4 ? "red" : "amber"} icon={<Clock size={15} />} />
        <StatTile label="In treatment" value={d.emergencyCases.filter((c) => c.status === "in_treatment").length} tone="brand" icon={<Stethoscope size={15} />} />
        <StatTile label="Triage 1 & 2" value={d.emergencyCases.filter((c) => c.triage <= 2 && c.status !== "discharged").length} tone="red" icon={<Siren size={15} />} />
        <StatTile label="Ambulances inbound" value={incoming.length} icon={<Ambulance size={15} />} />
      </div>

      {incoming.length > 0 && (
        <Card className="mb-4 border-rose-300 bg-rose-50/50">
          <CardHeader title="Inbound ambulances" subtitle="Pre-arrival alerts from the dispatch line" icon={<Radio size={16} />} />
          <div className="grid gap-3 sm:grid-cols-2">
            {incoming.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg bg-white p-3 ring-1 ring-rose-200">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-rose-600 text-white pulse-ring">
                  <Ambulance size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-900">{c.complaint}</p>
                  <p className="text-xs text-ink-600">{c.patientName} · {c.age}y · triage {c.triage}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold tabular-nums text-rose-600">{c.ambulanceEta}′</p>
                  <p className="text-[10px] text-ink-400">ETA</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-600">
            The ambulance line is answered by the AI agent, which captures the complaint, age and vitals and pushes this
            alert to the ED board before the patient arrives — so the resus bay and the team are ready.
          </p>
        </Card>
      )}

      <Card padded={false}>
        <div className="flex items-center gap-2 border-b border-ink-200 px-4 py-3">
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-auto">
            <option value="active">Active board</option>
            <option value="waiting">Waiting</option>
            <option value="in_treatment">In treatment</option>
            <option value="admitted">Admitted</option>
            <option value="discharged">Discharged</option>
            <option value="all">All cases</option>
          </Select>
          <div className="ml-auto flex flex-wrap gap-1.5 text-[10px]">
            {[1, 2, 3, 4, 5].map((t) => (
              <span key={t} className={cx("rounded-full border px-2 py-0.5", TRIAGE[t].cls)}>{TRIAGE[t].label}</span>
            ))}
          </div>
        </div>

        <div className="space-y-2 p-4">
          {cases.length === 0 && <EmptyState loading={!dataReady} title="Emergency department is clear" icon={<HeartPulse size={22} />} />}
          {cases.map((c) => (
            <button
              key={c.id}
              onClick={() => setOpen(c)}
              className={cx("flex w-full flex-wrap items-center gap-3 rounded-xl border-l-4 border-y border-r border-y-ink-200 border-r-ink-200 bg-white p-3 text-left transition hover:shadow", TRIAGE[c.triage].cls.split(" ")[0])}
            >
              <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-lg text-sm font-bold", TRIAGE[c.triage].cls)}>
                {c.triage}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-ink-900">{c.patientName}</p>
                  <span className="text-xs text-ink-500">{c.age}y</span>
                  <Badge tone={c.arrivalMode === "ambulance" ? "red" : "neutral"}>{c.arrivalMode.replace("_", " ")}</Badge>
                  <Badge tone={c.status === "waiting" ? "amber" : c.status === "in_treatment" ? "brand" : "green"}>{c.status.replace("_", " ")}</Badge>
                </div>
                <p className="mt-0.5 text-sm text-ink-700">{c.complaint}</p>
                <p className="mt-0.5 text-[11px] text-ink-400">
                  Arrived {relative(c.arrivedAt)} · target {TRIAGE[c.triage].target} · {c.assignedTo}
                </p>
              </div>
              <div className="flex gap-3 text-[11px] tabular-nums text-ink-600">
                <span><span className="block text-[9px] uppercase text-ink-400">BP</span>{c.vitals.bp}</span>
                <span><span className="block text-[9px] uppercase text-ink-400">Pulse</span>{c.vitals.pulse}</span>
                <span className={c.vitals.spo2 < 92 ? "text-rose-600" : ""}><span className="block text-[9px] uppercase text-ink-400">SpO₂</span>{c.vitals.spo2}%</span>
                <span className={c.vitals.temp > 38 ? "text-rose-600" : ""}><span className="block text-[9px] uppercase text-ink-400">Temp</span>{c.vitals.temp}°</span>
              </div>
            </button>
          ))}
        </div>
      </Card>

      <Modal
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={open?.patientName ?? ""}
        subtitle={open ? `${open.age}y · triage ${open.triage} · arrived ${relative(open.arrivedAt)}` : ""}
        footer={
          open && (
            <>
              <Button onClick={() => setOpen(null)}>Close</Button>
              {open.status === "waiting" && (
                <Button variant="primary" onClick={() => { updateEmergency(open.id, { status: "in_treatment" }); notify("Case moved to treatment"); setOpen(null); }}>
                  Start treatment
                </Button>
              )}
              {open.status === "in_treatment" && (
                <>
                  <Button onClick={() => { updateEmergency(open.id, { status: "discharged" }); audit("er.discharged", open.patientName); notify("Discharged — follow-up call scheduled for 48 hours"); setOpen(null); }}>
                    Discharge
                  </Button>
                  <Button variant="primary" onClick={() => { updateEmergency(open.id, { status: "admitted" }); audit("er.admitted", open.patientName, "warning"); notify("Admitted — bed request sent to IPD"); setOpen(null); }}>
                    Admit
                  </Button>
                </>
              )}
            </>
          )
        }
      >
        {open && (
          <div className="space-y-3">
            <div className={cx("rounded-xl border p-3", TRIAGE[open.triage].cls)}>
              <p className="text-sm font-semibold">{TRIAGE[open.triage].label}</p>
              <p className="text-xs opacity-80">Target time to clinician: {TRIAGE[open.triage].target}</p>
            </div>
            <p className="text-sm text-ink-800"><strong>Presenting complaint:</strong> {open.complaint}</p>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                ["BP", open.vitals.bp, ""],
                ["Pulse", `${open.vitals.pulse}`, "/min"],
                ["SpO₂", `${open.vitals.spo2}`, "%"],
                ["Temp", `${open.vitals.temp}`, "°C"],
              ].map(([k, v, u]) => (
                <div key={k} className="rounded-lg bg-ink-50 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-ink-400">{k}</p>
                  <p className="text-sm font-semibold tabular-nums text-ink-900">{v}<span className="text-[10px] text-ink-400">{u}</span></p>
                </div>
              ))}
            </div>
            <div className="space-y-1 text-xs">
              <p className="flex justify-between"><span className="text-ink-500">Arrival mode</span><span className="font-medium text-ink-800">{open.arrivalMode.replace("_", " ")}</span></p>
              <p className="flex justify-between"><span className="text-ink-500">Assigned clinician</span><span className="font-medium text-ink-800">{open.assignedTo}</span></p>
              <p className="flex justify-between"><span className="text-ink-500">Known patient</span><span className="font-medium text-ink-800">{open.patientId ? "Yes — record linked" : "No — new registration"}</span></p>
            </div>
            {open.patientId && (
              <Link href={`/patients/${open.patientId}`}>
                <Button size="sm" className="w-full" icon={<Activity size={13} />}>Open patient record</Button>
              </Link>
            )}
            <p className="rounded-lg bg-ink-50 p-3 text-[11px] leading-relaxed text-ink-500">
              <Thermometer size={12} className="mr-1 inline" />
              On discharge from the ED, a 48-hour AI check-in call is scheduled automatically in the patient&apos;s language —
              catching deterioration that would otherwise become a re-admission.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
