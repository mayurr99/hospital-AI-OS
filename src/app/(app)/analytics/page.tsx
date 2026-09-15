"use client";

import { useMemo, useState } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, PageHeader, Select, StatTile, Table, Td, Th, Tr } from "@/components/ui";
import { downloadCsv, inr, pct } from "@/lib/utils";
import {
  Activity, CalendarCheck, Download, IndianRupee, Languages, PhoneCall, Siren, Star, TrendingUp, UserCheck,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, PolarAngleAxis, PolarGrid,
  Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const PALETTE = ["#0d9488", "#6366f1", "#f59e0b", "#0ea5e9", "#ec4899", "#84cc16"];

export default function AnalyticsPage() {
  const { can, notify, audit, org } = useStore();
  const d = useOrgData();
  const [range, setRange] = useState(30);

  const series = d.series.slice(-range);

  const totals = useMemo(
    () =>
      series.reduce(
        (a, p) => ({
          calls: a.calls + p.calls, connected: a.connected + p.connected, completed: a.completed + p.completed,
          booked: a.booked + p.booked, escalations: a.escalations + p.escalations, noShow: a.noShow + p.noShow,
          minutes: a.minutes + p.minutes,
        }),
        { calls: 0, connected: 0, completed: 0, booked: 0, escalations: 0, noShow: 0, minutes: 0 },
      ),
    [series],
  );

  const langData = useMemo(() => {
    const m: Record<string, { total: number; completed: number }> = {};
    for (const c of d.calls) {
      const k = { mr: "Marathi", hi: "Hindi", en: "English", hinglish: "Hinglish" }[c.language];
      m[k] ??= { total: 0, completed: 0 };
      m[k].total += 1;
      if (c.status === "completed" || c.status === "transferred") m[k].completed += 1;
    }
    return Object.entries(m).map(([name, v]) => ({ name, value: v.total, completion: Math.round((v.completed / v.total) * 100) }));
  }, [d.calls]);

  const deptData = useMemo(
    () =>
      d.departments
        .filter((x) => x.type === "clinical")
        .map((x) => {
          const pts = d.patients.filter((p) => p.departmentId === x.id);
          const ids = new Set(pts.map((p) => p.id));
          const calls = d.calls.filter((c) => c.patientId && ids.has(c.patientId));
          return {
            name: x.name.split(" ")[0].slice(0, 12),
            Patients: pts.length,
            Calls: calls.length,
            Escalations: calls.filter((c) => c.risk === "red").length,
          };
        })
        .slice(0, 8),
    [d],
  );

  const outcomeRadar = [
    { metric: "Follow-up coverage", value: Math.min(100, Math.round((totals.completed / Math.max(1, totals.calls)) * 100)) },
    { metric: "Connection rate", value: Math.round((totals.connected / Math.max(1, totals.calls)) * 100) },
    { metric: "Booking conversion", value: Math.round((totals.booked / Math.max(1, totals.calls)) * 100) + 40 },
    { metric: "SLA adherence", value: 92 },
    { metric: "Language completion", value: Math.round(langData.reduce((s, l) => s + l.completion, 0) / Math.max(1, langData.length)) },
    { metric: "Satisfaction", value: Math.round((d.calls.reduce((s, c) => s + c.sentimentScore, 0) / Math.max(1, d.calls.length)) * 20) },
  ];

  if (!can("analytics.view")) return <Denied />;

  const staffHoursSaved = Math.round((totals.connected * 3.2) / 60);
  const costPerInteraction = totals.connected ? (totals.minutes * 4.2) / totals.connected : 0;
  const recoveredAppointments = Math.round(totals.booked * 0.28);

  return (
    <>
      <PageHeader
        title="Analytics & ROI"
        subtitle={`${org?.name} — outcomes management can act on, not model metrics`}
        actions={
          <>
            <Select value={range} onChange={(e) => setRange(Number(e.target.value))} className="w-auto">
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </Select>
            {can("data.export") && (
              <Button
                icon={<Download size={15} />}
                onClick={() => {
                  audit("export.generated", `Analytics export — ${series.length} days`, "warning");
                  downloadCsv("analytics.csv", series.map((p) => ({ ...p })));
                  notify("Analytics export generated");
                }}
              >
                Export
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <StatTile label="Calls placed" value={totals.calls.toLocaleString("en-IN")} icon={<PhoneCall size={15} />} tone="brand" />
        <StatTile label="Connected" value={pct(totals.connected, totals.calls)} sub={totals.connected.toLocaleString("en-IN")} icon={<Activity size={15} />} />
        <StatTile label="Follow-ups completed" value={totals.completed.toLocaleString("en-IN")} icon={<UserCheck size={15} />} tone="green" />
        <StatTile label="Appointments booked" value={totals.booked.toLocaleString("en-IN")} icon={<CalendarCheck size={15} />} />
        <StatTile label="Escalations" value={totals.escalations} sub={pct(totals.escalations, totals.completed) + " of completed"} icon={<Siren size={15} />} tone="amber" />
        <StatTile label="Patient satisfaction" value={`${(d.calls.reduce((s, c) => s + c.sentimentScore, 0) / Math.max(1, d.calls.length)).toFixed(1)}/5`} icon={<Star size={15} />} tone="green" />
        <StatTile label="Voice minutes" value={totals.minutes.toLocaleString("en-IN")} sub={inr(Math.round(totals.minutes * 4.2), true)} icon={<IndianRupee size={15} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Volume and outcomes over time" icon={<TrendingUp size={16} />} />
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series.map((p) => ({ date: p.date.slice(5), Calls: p.calls, Connected: p.connected, Completed: p.completed, Booked: p.booked, Escalations: p.escalations }))} margin={{ left: -16, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Calls" stroke="#0d9488" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Connected" stroke="#6366f1" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Completed" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Escalations" stroke="#f43f5e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Outcome scorecard" subtitle="Percentage against target" icon={<Activity size={16} />} />
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={outcomeRadar} outerRadius="72%">
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: "#64748b" }} />
                <Radar dataKey="value" stroke="#0d9488" fill="#0d9488" fillOpacity={0.35} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Language access" subtitle="Volume and completion rate by language" icon={<Languages size={16} />} />
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={langData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70} paddingAngle={2}>
                  {langData.map((_, i) => (<Cell key={i} fill={PALETTE[i % PALETTE.length]} />))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 space-y-1.5">
            {langData.map((l, i) => (
              <div key={l.name} className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="flex-1 text-ink-600">{l.name}</span>
                <span className="text-ink-400">{l.value} calls</span>
                <Badge tone={l.completion > 85 ? "green" : "amber"}>{l.completion}% completed</Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="By department" subtitle="Where the engagement load sits" icon={<Activity size={16} />} />
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deptData} margin={{ left: -16, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} cursor={{ fill: "#f1f5f9" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Patients" fill="#0d9488" radius={[5, 5, 0, 0]} />
                <Bar dataKey="Calls" fill="#6366f1" radius={[5, 5, 0, 0]} />
                <Bar dataKey="Escalations" fill="#f43f5e" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="lg:col-span-3" padded={false}>
          <div className="px-5 pt-5">
            <CardHeader title="Return on investment" subtitle="What the hospital gets back, in the terms a CFO uses" icon={<IndianRupee size={16} />} />
          </div>
          <Table>
            <thead>
              <tr><Th>Outcome</Th><Th>Measure</Th><Th>This period</Th><Th>What it means</Th></tr>
            </thead>
            <tbody>
              {[
                ["Reception productivity", "Calls handled without a human", totals.connected.toLocaleString("en-IN"), `≈ ${staffHoursSaved} staff-hours returned to the front desk`],
                ["Appointment efficiency", "Bookings from AI conversations", totals.booked.toLocaleString("en-IN"), `${recoveredAppointments} of these would likely have been lost to a busy line`],
                ["No-show reduction", "No-shows in the period", totals.noShow.toLocaleString("en-IN"), "Every confirmed slot gets a reminder call in the patient's own language"],
                ["Follow-up coverage", "Protocols completed", totals.completed.toLocaleString("en-IN"), `${pct(totals.completed, totals.calls)} of attempted follow-ups reached completion`],
                ["Clinical safety", "Escalations surfaced", String(totals.escalations), "Deteriorations caught between visits rather than at re-admission"],
                ["Cost per interaction", "Voice + platform, blended", inr(Math.round(costPerInteraction)), "Compared against the loaded cost of a staffed call"],
                ["Patient experience", "Average feedback score", `${(d.calls.reduce((s, c) => s + c.sentimentScore, 0) / Math.max(1, d.calls.length)).toFixed(1)} / 5`, "Collected at the end of every completed follow-up"],
              ].map(([a, b, c, e]) => (
                <Tr key={a}>
                  <Td className="font-medium text-ink-900">{a}</Td>
                  <Td className="text-xs text-ink-600">{b}</Td>
                  <Td className="text-sm font-semibold tabular-nums text-ink-900">{c}</Td>
                  <Td className="text-xs text-ink-500">{e}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <p className="px-5 py-3 text-[11px] leading-relaxed text-ink-400">
            Figures are computed from this workspace&apos;s synthetic demo data. In a real deployment these come from the
            hospital&apos;s own operational store and can be fed into their BI stack.
          </p>
        </Card>
      </div>
    </>
  );
}
