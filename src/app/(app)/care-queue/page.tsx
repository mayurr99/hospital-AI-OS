"use client";

import Link from "next/link";
import { useState } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { useSticky } from "@/lib/sticky";
import { Denied } from "@/components/AppShell";
import { Avatar, Badge, Button, Card, EmptyState, PageHeader, Select, StatTile, Tabs } from "@/components/ui";
import { relative, relativeFuture } from "@/lib/utils";
import type { Task } from "@/lib/types";
import {
  CalendarPlus, CheckCircle2, ClipboardList, MessageSquare, PhoneOff, PhoneOutgoing, Pill, Siren, UserPlus,
} from "lucide-react";

const QUEUE_META: Record<Task["queue"], { label: string; icon: React.ReactNode; hint: string }> = {
  critical: { label: "Critical escalation", icon: <Siren size={14} />, hint: "Immediate configured response and acknowledgement tracking" },
  review: { label: "Needs review", icon: <ClipboardList size={14} />, hint: "Patient-reported updates prepared for clinician review" },
  callback: { label: "Requested callbacks", icon: <PhoneOutgoing size={14} />, hint: "Patients explicitly asking for clinician contact" },
  medication: { label: "Medication questions", icon: <Pill size={14} />, hint: "Routed to an authorised clinician — never answered by AI" },
  appointment: { label: "Appointment issues", icon: <CalendarPlus size={14} />, hint: "Scheduling needs raised during a follow-up call" },
  unreachable: { label: "Unreachable patients", icon: <PhoneOff size={14} />, hint: "Retry per policy or switch to an alternate channel" },
};

export default function CareQueuePage() {
  const { can, updateTask, notify, audit, users, currentUser, dataReady } = useStore();
  const d = useOrgData();
  const [tab, setTab] = useSticky<Task["queue"] | "all">("careQueue.tab", "all");
  const [assignFilter, setAssignFilter] = useState("all");

  if (!can("queue.care")) return <Denied />;

  const openTasks = d.tasks.filter((t) => t.status !== "done");
  const rows = openTasks.filter((t) => {
    if (tab !== "all" && t.queue !== tab) return false;
    if (assignFilter === "mine" && t.assignedTo !== currentUser?.id) return false;
    if (assignFilter === "unassigned" && t.assignedTo) return false;
    return true;
  });

  const counts = (q: Task["queue"]) => openTasks.filter((t) => t.queue === q).length;

  return (
    <>
      <PageHeader
        title="Care coordinator queue"
        subtitle="One work surface for everything the AI could not close on its own"
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(Object.keys(QUEUE_META) as Task["queue"][]).map((q) => (
          <StatTile
            key={q}
            label={QUEUE_META[q].label}
            value={counts(q)}
            icon={QUEUE_META[q].icon}
            tone={q === "critical" ? "red" : q === "review" ? "amber" : "neutral"}
            onClick={() => setTab(q)}
          />
        ))}
      </div>

      <Card padded={false}>
        <div className="border-b border-ink-200 px-4 pt-2">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: "all" as const, label: "All open", count: openTasks.length },
              ...(Object.keys(QUEUE_META) as Task["queue"][]).map((q) => ({ key: q, label: QUEUE_META[q].label, count: counts(q) })),
            ]}
          />
        </div>

        <div className="flex items-center gap-2 border-b border-ink-200 px-4 py-3">
          <Select value={assignFilter} onChange={(e) => setAssignFilter(e.target.value)} className="w-auto">
            <option value="all">All assignments</option>
            <option value="mine">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
          </Select>
          {tab !== "all" && <p className="text-xs text-ink-500">{QUEUE_META[tab as Task["queue"]].hint}</p>}
        </div>

        <div className="divide-y divide-ink-100">
          {rows.length === 0 && <div className="p-6"><EmptyState loading={!dataReady} title="Queue is clear" icon={<CheckCircle2 size={22} />} /></div>}
          {rows.slice(0, 40).map((t) => {
            const p = d.patients.find((x) => x.id === t.patientId);
            const assignee = users.find((u) => u.id === t.assignedTo);
            const thread = d.threads.find((x) => x.patientId === t.patientId);
            return (
              <div key={t.id} className="flex flex-wrap items-start gap-3 px-4 py-3.5">
                <Avatar name={p?.name ?? "?"} size={36} hue={p?.gender === "F" ? 320 : 205} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/patients/${p?.id}`} className="text-sm font-semibold text-ink-900 hover:text-brand-700">{p?.name}</Link>
                    <Badge tone={t.queue === "critical" ? "red" : t.queue === "review" ? "amber" : "neutral"}>
                      {QUEUE_META[t.queue].label}
                    </Badge>
                    {t.priority === "high" && <Badge tone="red">high priority</Badge>}
                    <span className="text-[11px] text-ink-400">raised {relative(t.createdAt)} · due {relativeFuture(t.dueAt)}</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-ink-800">{t.title}</p>
                  <p className="text-xs leading-relaxed text-ink-600">{t.detail}</p>
                  <p className="mt-1 text-[11px] text-ink-400">
                    {assignee ? `Assigned to ${assignee.name}` : "Unassigned"}
                    {p && ` · ${p.carePathway}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {t.queue === "unreachable" && thread && (
                    <Link href={`/messages?thread=${thread.id}`}><Button size="sm" icon={<MessageSquare size={13} />}>WhatsApp</Button></Link>
                  )}
                  {t.queue !== "unreachable" && (
                    <Link href={`/live?patient=${t.patientId}`}><Button size="sm" icon={<PhoneOutgoing size={13} />}>Call</Button></Link>
                  )}
                  {!t.assignedTo && (
                    <Button size="sm" icon={<UserPlus size={13} />} onClick={() => { updateTask(t.id, { assignedTo: currentUser!.id }); notify("Assigned to you"); }}>
                      Take
                    </Button>
                  )}
                  <Button size="sm" variant="primary" onClick={() => { updateTask(t.id, { status: "done" }); audit("task.closed", `${t.id} — ${p?.name}`); notify("Task closed"); }}>
                    Close
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
