"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Progress, StatTile, Table, Td, Th, Tr } from "@/components/ui";
import { fmtTime, inr, pct, relative, RISK_STYLES, cx } from "@/lib/utils";
import {
  Activity, AlertTriangle, BedDouble, CalendarCheck, ClipboardList, IndianRupee, PhoneCall,
  Siren, Stethoscope, TrendingUp, Users,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export default function DashboardPage() {
  const { currentUser, org, can, dataReady } = useStore();
  const d = useOrgData();

  const today = new Date().toDateString();
  const stats = useMemo(() => {
    const todaysAppts = d.appointments.filter((a) => new Date(a.start).toDateString() === today);
    const callsToday = d.calls.filter((c) => new Date(c.startedAt).toDateString() === today);
    const connected = callsToday.filter((c) => c.status !== "no_answer" && c.status !== "failed");
    const occupied = d.beds.filter((b) => b.status === "occupied").length;
    const revenue = d.invoices
      .filter((i) => new Date(i.issuedAt).toDateString() === today)
      .reduce((s, i) => s + i.lines.reduce((x, l) => x + l.qty * l.rate, 0) - i.discount, 0);
    return {
      todaysAppts,
      callsToday,
      connected,
      openEsc: d.escalations.filter((e) => e.status === "open"),
      pendingReview: d.calls.filter((c) => c.reviewStatus === "pending"),
      openTasks: d.tasks.filter((t) => t.status === "open"),
      occupancy: d.beds.length ? Math.round((occupied / d.beds.length) * 100) : 0,
      occupied,
      revenue,
      erWaiting: d.emergencyCases.filter((e) => e.status === "waiting"),
      criticalLabs: d.labOrders.filter((l) => l.criticalFlag),
      lowStock: d.drugs.filter((x) => x.stock < x.reorderLevel),
    };
  }, [d, today]);

  const series = d.series.slice(-14).map((p) => ({
    day: p.date.slice(5),
    Calls: p.calls,
    Connected: p.connected,
    Completed: p.completed,
    Escalations: p.escalations,
    Booked: p.booked,
  }));

  const langMix = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of d.calls) m[c.language] = (m[c.language] ?? 0) + 1;
    const labels: Record<string, string> = { mr: "Marathi", hi: "Hindi", en: "English", hinglish: "Hinglish" };
    return Object.entries(m).map(([k, v]) => ({ name: labels[k] ?? k, value: v }));
  }, [d.calls]);

  const PIE = ["#0d9488", "#6366f1", "#f59e0b", "#ec4899"];

  const isDoctor = currentUser?.role === "doctor";

  return (
    <>
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${currentUser?.name.split(" ")[0]}`}
        subtitle={`${org?.name} · ${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}`}
      />

      {/* alert strip */}
      {(stats.openEsc.length > 0 || stats.erWaiting.length > 0 || stats.criticalLabs.length > 0) && (
        <div className="mb-5 flex flex-wrap gap-2">
          {stats.openEsc.length > 0 && can("escalations.view") && (
            <Link href="/escalations" className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 hover:bg-rose-100">
              <Siren size={15} /> <strong>{stats.openEsc.length}</strong> unacknowledged escalation{stats.openEsc.length > 1 ? "s" : ""}
              <span className="text-xs text-rose-600">· SLA clock running</span>
            </Link>
          )}
          {stats.erWaiting.length > 0 && can("emergency.manage") && (
            <Link href="/emergency" className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 hover:bg-amber-100">
              <AlertTriangle size={15} /> <strong>{stats.erWaiting.length}</strong> patients waiting in Emergency
            </Link>
          )}
          {stats.criticalLabs.length > 0 && can("labs.manage") && (
            <Link href="/labs" className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900 hover:bg-violet-100">
              <Activity size={15} /> <strong>{stats.criticalLabs.length}</strong> critical lab value{stats.criticalLabs.length > 1 ? "s" : ""} to verify
            </Link>
          )}
        </div>
      )}

      {/* stat tiles */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <StatTile label="AI calls today" value={stats.callsToday.length} sub={`${pct(stats.connected.length, stats.callsToday.length)} connected`} icon={<PhoneCall size={15} />} tone="brand" />
        <StatTile label="Appointments today" value={stats.todaysAppts.length} sub={`${stats.todaysAppts.filter((a) => a.source === "ai_receptionist").length} booked by AI`} icon={<CalendarCheck size={15} />} />
        <StatTile label="Needs clinician review" value={stats.pendingReview.length} sub="from follow-up calls" icon={<Stethoscope size={15} />} tone="amber" />
        <StatTile label="Open escalations" value={stats.openEsc.length} sub={stats.openEsc.filter((e) => e.level === "red").length + " red"} icon={<Siren size={15} />} tone={stats.openEsc.length ? "red" : "green"} />
        <StatTile label="Bed occupancy" value={`${stats.occupancy}%`} sub={`${stats.occupied} of ${d.beds.length} beds`} icon={<BedDouble size={15} />} />
        <StatTile label="Billed today" value={inr(stats.revenue, true)} sub={`${d.invoices.filter((i) => i.status === "overdue").length} overdue invoices`} icon={<IndianRupee size={15} />} tone="green" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* engagement chart */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Patient engagement — last 14 days"
            subtitle="Outbound follow-up and inbound receptionist volume"
            icon={<TrendingUp size={16} />}
            action={<Link href="/analytics" className="text-xs font-medium text-brand-700 hover:underline">Full analytics →</Link>}
          />
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ left: -20, right: 4, top: 4 }}>
                <defs>
                  <linearGradient id="gCalls" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0d9488" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0d9488" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gDone" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="Calls" stroke="#0d9488" fill="url(#gCalls)" strokeWidth={2} />
                <Area type="monotone" dataKey="Completed" stroke="#6366f1" fill="url(#gDone)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* language mix */}
        <Card>
          <CardHeader title="Language mix" subtitle="Share of AI conversations" icon={<Activity size={16} />} />
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={langMix} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={2}>
                  {langMix.map((_, i) => (
                    <Cell key={i} fill={PIE[i % PIE.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 space-y-1.5">
            {langMix.map((l, i) => (
              <div key={l.name} className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 rounded-full" style={{ background: PIE[i % PIE.length] }} />
                <span className="flex-1 text-ink-600">{l.name}</span>
                <span className="font-medium text-ink-900">{pct(l.value, d.calls.length)}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* today's schedule */}
        <Card className="lg:col-span-2">
          <CardHeader
            title={isDoctor ? "Your clinic today" : "Today's appointments"}
            subtitle={`${stats.todaysAppts.length} scheduled · ${stats.todaysAppts.filter((a) => a.status === "completed").length} completed`}
            icon={<CalendarCheck size={16} />}
            action={<Link href="/appointments" className="text-xs font-medium text-brand-700 hover:underline">Open calendar →</Link>}
          />
          {stats.todaysAppts.length === 0 ? (
            <EmptyState loading={!dataReady} title="No appointments scheduled today" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Time</Th>
                  <Th>Patient</Th>
                  <Th>Doctor</Th>
                  <Th>Source</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {stats.todaysAppts
                  .filter((a) => !isDoctor || a.providerId === currentUser?.providerId)
                  .sort((a, b) => (a.start < b.start ? -1 : 1))
                  .slice(0, 7)
                  .map((a) => {
                    const p = d.patients.find((x) => x.id === a.patientId);
                    const pr = d.providers.find((x) => x.id === a.providerId);
                    return (
                      <Tr key={a.id}>
                        <Td className="font-medium tabular-nums">{fmtTime(a.start)}</Td>
                        <Td>
                          <Link href={`/patients/${p?.id}`} className="font-medium text-ink-900 hover:text-brand-700">
                            {p?.name}
                          </Link>
                          <span className="block text-[11px] text-ink-400">{p?.mrn}</span>
                        </Td>
                        <Td className="text-xs">{pr?.name}</Td>
                        <Td>
                          <Badge tone={a.source === "ai_receptionist" ? "brand" : "neutral"}>
                            {a.source.replace(/_/g, " ")}
                          </Badge>
                        </Td>
                        <Td>
                          <Badge tone={a.status === "completed" ? "green" : a.status === "cancelled" || a.status === "no_show" ? "red" : "blue"}>
                            {a.status.replace("_", " ")}
                          </Badge>
                        </Td>
                      </Tr>
                    );
                  })}
              </tbody>
            </Table>
          )}
        </Card>

        {/* review queue / tasks */}
        <Card>
          <CardHeader
            title={isDoctor ? "Your review queue" : "Care team queue"}
            subtitle={`${stats.openTasks.length} open items`}
            icon={<ClipboardList size={16} />}
            action={
              <Link href={isDoctor ? "/doctor-crm" : "/care-queue"} className="text-xs font-medium text-brand-700 hover:underline">
                Open →
              </Link>
            }
          />
          <div className="space-y-2">
            {stats.pendingReview.slice(0, 5).map((c) => {
              const p = d.patients.find((x) => x.id === c.patientId);
              return (
                <Link
                  key={c.id}
                  href={`/calls?id=${c.id}`}
                  className="block rounded-lg border border-ink-200 p-2.5 transition hover:border-brand-300 hover:bg-brand-50/30"
                >
                  <div className="flex items-center gap-2">
                    <span className={cx("h-2 w-2 shrink-0 rounded-full", RISK_STYLES[c.risk].dot)} />
                    <span className="flex-1 truncate text-sm font-medium text-ink-900">{c.patientName}</span>
                    <span className="text-[10px] text-ink-400">{relative(c.startedAt)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-500">{c.summary}</p>
                  {p && <p className="mt-1 text-[10px] text-ink-400">{p.diagnosis}</p>}
                </Link>
              );
            })}
            {stats.pendingReview.length === 0 && <EmptyState loading={!dataReady} title="Review queue is clear" />}
          </div>
        </Card>

        {/* campaigns */}
        <Card className="lg:col-span-3">
          <CardHeader
            title="Running follow-up campaigns"
            subtitle="Hospital-approved protocols executing on schedule"
            icon={<Users size={16} />}
            action={<Link href="/campaigns" className="text-xs font-medium text-brand-700 hover:underline">Manage campaigns →</Link>}
          />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {d.campaigns.slice(0, 6).map((c) => (
              <div key={c.id} className="rounded-lg border border-ink-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-ink-900">{c.name}</p>
                  <Badge tone={c.status === "running" ? "green" : c.status === "paused" ? "amber" : c.status === "scheduled" ? "blue" : "neutral"}>
                    {c.status}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-ink-500">{c.cohortDescription}</p>
                <div className="mt-2.5">
                  <Progress value={c.completed} max={c.totalPatients} tone={c.escalated > 5 ? "amber" : "brand"} />
                  <div className="mt-1.5 flex justify-between text-[11px] text-ink-500">
                    <span>{c.completed} of {c.totalPatients} completed</span>
                    <span className={c.escalated ? "text-rose-600" : ""}>{c.escalated} escalated</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
