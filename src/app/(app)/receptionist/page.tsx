"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, PageHeader, StatTile, Table, Td, Th, Tr, Progress } from "@/components/ui";
import { seed } from "@/lib/store";
import { duration, LANGUAGE_LABELS, pct, relative } from "@/lib/utils";
import {
  ArrowRightLeft, BookOpen, Bot, CheckCircle2, Clock, Languages, PhoneForwarded, PhoneIncoming,
  PlayCircle, Repeat,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function ReceptionistPage() {
  const { can, org } = useStore();
  const d = useOrgData();

  const inbound = d.calls.filter((c) => c.agentType === "receptionist");
  const agent = d.agents.find((a) => a.type === "receptionist");
  const tel = d.telephony;

  const intents = useMemo(() => {
    const m: Record<string, number> = { "Book appointment": 0, "Reschedule": 0, "Cancel": 0, "FAQ / information": 0, "Human transfer": 0 };
    inbound.forEach((c, i) => {
      const key = c.outcome.toLowerCase().includes("book") ? "Book appointment"
        : i % 7 === 0 ? "Reschedule"
        : i % 11 === 0 ? "Cancel"
        : i % 5 === 0 ? "Human transfer"
        : "FAQ / information";
      m[key] += 1;
    });
    return Object.entries(m).map(([name, value]) => ({ name, value }));
  }, [inbound]);

  const BAR = ["#0d9488", "#6366f1", "#f59e0b", "#0ea5e9", "#94a3b8"];

  if (!can("calls.view")) return <Denied />;

  return (
    <>
      <PageHeader
        title="AI receptionist"
        subtitle="A 24×7 multilingual front desk with administrative scope only — it never sees clinical history"
        actions={
          can("calls.initiate") && (
            <Link href="/live?agent=receptionist">
              <Button variant="primary" icon={<PlayCircle size={15} />}>Simulate an inbound call</Button>
            </Link>
          )
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Inbound handled" value={inbound.length} icon={<PhoneIncoming size={15} />} tone="brand" />
        <StatTile label="Booked without a human" value={inbound.filter((c) => c.outcome.toLowerCase().includes("book")).length} icon={<CheckCircle2 size={15} />} tone="green" />
        <StatTile label="Transferred to staff" value={inbound.filter((c) => c.status === "transferred").length} sub={pct(inbound.filter((c) => c.status === "transferred").length, inbound.length) + " of calls"} icon={<ArrowRightLeft size={15} />} />
        <StatTile label="Avg handling time" value={duration(Math.round(inbound.reduce((s, c) => s + c.durationSeconds, 0) / Math.max(1, inbound.length)))} icon={<Clock size={15} />} />
        <StatTile label="Concurrent channels" value={tel.concurrentChannels} sub={tel.provider.split(" ")[0]} icon={<PhoneForwarded size={15} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="What callers ask for" subtitle="Intent distribution across handled calls" icon={<Bot size={16} />} />
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={intents} layout="vertical" margin={{ left: 40, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: "#475569" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} cursor={{ fill: "#f1f5f9" }} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {intents.map((_, i) => (
                    <Cell key={i} fill={BAR[i % BAR.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Agent configuration" subtitle={agent ? `${agent.name} · ${agent.version}` : ""} icon={<Bot size={16} />} />
          {agent && (
            <div className="space-y-2 text-xs">
              <Row k="Status"><Badge tone={agent.status === "published" ? "green" : "amber"}>{agent.status}</Badge></Row>
              <Row k="Voice">{agent.voice}</Row>
              <Row k="Identity check">{agent.identityVerification.replace("_", " + ")}</Row>
              <Row k="Recording">{agent.recordingPolicy}</Row>
              <Row k="Max turns">{agent.maxTurns}</Row>
              <Row k="Transfer to">{agent.humanTransferNumber}</Row>
              <div className="pt-1">
                <p className="mb-1 text-ink-500">Languages</p>
                <div className="flex flex-wrap gap-1">
                  {agent.languages.map((l) => (
                    <Badge key={l} tone="brand">{LANGUAGE_LABELS[l]}</Badge>
                  ))}
                </div>
              </div>
              <div className="pt-1">
                <p className="mb-1 text-ink-500">Allowed capabilities</p>
                <div className="flex flex-wrap gap-1">
                  {agent.capabilities.map((c) => (
                    <Badge key={c}>{c}</Badge>
                  ))}
                </div>
              </div>
              {can("agents.configure") && (
                <Link href="/admin/agents" className="block pt-2">
                  <Button size="sm" className="w-full">Open agent configuration</Button>
                </Link>
              )}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Recent front-desk calls" icon={<PhoneIncoming size={16} />} action={<Link href="/calls" className="text-xs font-medium text-brand-700 hover:underline">All calls →</Link>} />
          <Table>
            <thead>
              <tr><Th>Caller</Th><Th>Language</Th><Th>Outcome</Th><Th>Duration</Th><Th>When</Th></tr>
            </thead>
            <tbody>
              {inbound.slice(0, 8).map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <span className="block text-sm font-medium text-ink-900">{c.patientName}</span>
                    <span className="block text-[11px] text-ink-400">{c.phone}</span>
                  </Td>
                  <Td><Badge>{LANGUAGE_LABELS[c.language].split(" ")[0]}</Badge></Td>
                  <Td className="text-xs">{c.outcome}</Td>
                  <Td className="tabular-nums text-xs">{duration(c.durationSeconds)}</Td>
                  <Td className="text-xs text-ink-500">{relative(c.startedAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Transfer destinations" subtitle="Where a human takes over" icon={<PhoneForwarded size={16} />} />
          <div className="space-y-2">
            {tel.transferDestinations.map((t) => (
              <div key={t.label} className="rounded-lg border border-ink-200 p-2.5 text-xs">
                <p className="font-medium text-ink-900">{t.label}</p>
                <p className="tabular-nums text-ink-600">{t.number}</p>
                <p className="text-[11px] text-ink-400">{t.hours}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg bg-ink-50 p-3 text-[11px] leading-relaxed text-ink-500">
            Transfer happens on explicit request, low conversation confidence, an unsupported intent, or any configured
            scenario. If the AI service itself is unavailable, the line falls back to the normal IVR / human path at{" "}
            <strong className="text-ink-700">{tel.fallbackNumber}</strong>.
          </div>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Approved knowledge base"
            subtitle={`${seed.KNOWLEDGE_BASE.length} answers · version ${seed.KNOWLEDGE_BASE[0].version} · the agent may answer from this and nothing else`}
            icon={<BookOpen size={16} />}
          />
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {seed.KNOWLEDGE_BASE.map((k) => (
              <div key={k.q} className="rounded-lg border border-ink-200 p-3">
                <p className="text-xs font-semibold text-ink-900">{k.q}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-600">{k.a}</p>
                <div className="mt-1.5 flex gap-1">
                  {k.tags.map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 rounded-lg bg-ink-50 p-3 text-[11px] leading-relaxed text-ink-500">
            If a caller asks something outside this knowledge base, the agent does not improvise — it offers a transfer or
            a callback. This is what keeps the front desk safe to hand to a hospital.
          </p>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Booking reliability" subtitle="Why concurrent callers never collide" icon={<Repeat size={16} />} />
          <div className="grid gap-3 md:grid-cols-5">
            {[
              ["Intent & speciality", "Caller intent classified; speciality and facility resolved."],
              ["Live availability", "Slots read from the appointment engine / HIS, not a cached sheet."],
              ["Temporary hold", "A 90-second lock stops a second caller taking the same slot."],
              ["Re-check & write", "Availability re-verified, then an atomic, idempotent write."],
              ["Confirm & sync", "Appointment ID issued, HIS updated, WhatsApp confirmation sent."],
            ].map(([t, s], i) => (
              <div key={t} className="rounded-lg border border-ink-200 p-3">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-[10px] font-bold text-white">{i + 1}</span>
                  <p className="text-xs font-semibold text-ink-900">{t}</p>
                </div>
                <p className="text-[11px] leading-relaxed text-ink-600">{s}</p>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-[11px] text-ink-500">
              <span>Bookings completed without human help</span>
              <span className="font-medium text-ink-900">
                {pct(inbound.filter((c) => c.status === "completed").length, inbound.length)}
              </span>
            </div>
            <Progress value={inbound.filter((c) => c.status === "completed").length} max={Math.max(1, inbound.length)} tone="green" />
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Live demo line" subtitle="For hospital demos — hand the doctor a phone" icon={<Languages size={16} />} />
        <div className="flex flex-wrap items-center gap-4">
          <div className="rounded-xl border-2 border-dashed border-brand-300 bg-brand-50 px-5 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-brand-700">{org?.shortName} AI line</p>
            <p className="text-xl font-semibold tabular-nums text-ink-900">{tel.aiNumber}</p>
          </div>
          <p className="max-w-md text-xs leading-relaxed text-ink-600">
            &ldquo;Call this number and book an appointment yourself, in whichever language you prefer.&rdquo; The booking
            appears on the appointments calendar in real time while the doctor is still on the call — that moment is the
            demo.
          </p>
        </div>
      </Card>
    </>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center justify-between gap-2">
      <span className="text-ink-500">{k}</span>
      <span className="text-right font-medium text-ink-800">{children}</span>
    </p>
  );
}
