"use client";

import { Suspense, useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useOrgData, useStore } from "@/lib/store";
import { useSticky } from "@/lib/sticky";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, StatTile, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { cx, downloadCsv, duration, fmtDateTime, inr, LANGUAGE_SHORT, pct, relative, RISK_STYLES } from "@/lib/utils";
import { Bot, Download, FileText, PhoneCall, Play, Search, ShieldCheck, User } from "lucide-react";

export default function CallsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-500">Loading calls…</p>}>
      <CallsInner />
    </Suspense>
  );
}

type TabKey = "all" | "care" | "receptionist" | "review" | "escalated";

function CallsInner() {
  const sp = useSearchParams();
  const { can, notify, audit, reviewCall } = useStore();
  const d = useOrgData();
  const [tab, setTab] = useSticky<TabKey>("calls.tab", "all");
  const [q, setQ] = useSticky("calls.q", "");
  const [lang, setLang] = useState("all");
  const [openId, setOpenId] = useState<string | null>(sp.get("id"));
  const [showTranslation, setShowTranslation] = useState(true);

  useEffect(() => { if (sp.get("id")) setOpenId(sp.get("id")); }, [sp]);

  const rows = useMemo(
    () =>
      d.calls.filter((c) => {
        if (tab === "care" && c.agentType !== "care") return false;
        if (tab === "receptionist" && c.agentType !== "receptionist") return false;
        if (tab === "review" && c.reviewStatus !== "pending") return false;
        if (tab === "escalated" && c.risk !== "red") return false;
        if (lang !== "all" && c.language !== lang) return false;
        if (q.trim() && !c.patientName.toLowerCase().includes(q.toLowerCase()) && !c.phone.includes(q)) return false;
        return true;
      }),
    [d.calls, tab, lang, q],
  );

  const open = d.calls.find((c) => c.id === openId);
  const connected = d.calls.filter((c) => c.status !== "no_answer" && c.status !== "failed");

  if (!can("calls.view")) return <Denied />;

  return (
    <>
      <PageHeader
        title="Call history"
        subtitle="Every AI conversation with transcript, structured extraction and full governance provenance"
        actions={
          can("data.export") && (
            <Button
              icon={<Download size={15} />}
              onClick={() => {
                audit("export.generated", `Call report — ${rows.length} rows`, "warning");
                downloadCsv("calls_export.csv", rows.map((c) => ({
                  CallID: c.id, Patient: c.patientName, Direction: c.direction, Agent: c.agentType,
                  Language: c.language, Started: fmtDateTime(c.startedAt), DurationSec: c.durationSeconds,
                  Status: c.status, Outcome: c.outcome, Risk: c.risk, Review: c.reviewStatus,
                  Feedback: c.sentimentScore, CostINR: c.costRupees, AgentVersion: c.agentVersion,
                  ProtocolVersion: c.protocolVersion,
                })));
                notify("Governed export generated — download logged");
              }}
            >
              Export report
            </Button>
          )
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Total calls" value={d.calls.length} icon={<PhoneCall size={15} />} tone="brand" />
        <StatTile label="Connection rate" value={pct(connected.length, d.calls.length)} sub={`${connected.length} connected`} />
        <StatTile label="Avg duration" value={duration(Math.round(connected.reduce((s, c) => s + c.durationSeconds, 0) / Math.max(1, connected.length)))} />
        <StatTile label="Pending review" value={d.calls.filter((c) => c.reviewStatus === "pending").length} tone="amber" />
        <StatTile label="Voice spend" value={inr(Math.round(d.calls.reduce((s, c) => s + c.costRupees, 0)))} sub="at ₹4.20/min blended" />
      </div>

      <Card padded={false}>
        <div className="border-b border-ink-200 px-4 pt-2">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: "all", label: "All calls", count: d.calls.length },
              { key: "care", label: "Follow-up", count: d.calls.filter((c) => c.agentType === "care").length },
              { key: "receptionist", label: "Front desk", count: d.calls.filter((c) => c.agentType === "receptionist").length },
              { key: "review", label: "Needs review", count: d.calls.filter((c) => c.reviewStatus === "pending").length },
              { key: "escalated", label: "Escalated", count: d.calls.filter((c) => c.risk === "red").length },
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-2 border-b border-ink-200 px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <Input className="pl-9" placeholder="Patient name or number…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select value={lang} onChange={(e) => setLang(e.target.value)} className="w-auto">
            <option value="all">All languages</option>
            <option value="mr">Marathi</option>
            <option value="hi">Hindi</option>
            <option value="en">English</option>
            <option value="hinglish">Hinglish</option>
          </Select>
        </div>

        <Table>
          <thead>
            <tr>
              <Th>Patient</Th><Th>Agent</Th><Th>Lang</Th><Th>Started</Th><Th>Duration</Th>
              <Th>Outcome</Th><Th>Risk</Th><Th>Review</Th><Th />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map((c) => (
              <Tr key={c.id} onClick={() => setOpenId(c.id)}>
                <Td>
                  <span className="block text-sm font-medium text-ink-900">{c.patientName}</span>
                  <span className="block text-[11px] text-ink-400">{c.direction === "inbound" ? "↙ inbound" : "↗ outbound"} · {c.phone}</span>
                </Td>
                <Td><Badge tone={c.agentType === "care" ? "purple" : "blue"}>{c.agentType}</Badge></Td>
                <Td><Badge>{LANGUAGE_SHORT[c.language]}</Badge></Td>
                <Td className="whitespace-nowrap text-xs text-ink-500">{relative(c.startedAt)}</Td>
                <Td className="tabular-nums text-xs">{duration(c.durationSeconds)}</Td>
                <Td className="max-w-[220px] text-xs">{c.outcome}</Td>
                <Td>
                  <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", RISK_STYLES[c.risk].chip)}>
                    <span className={cx("h-1.5 w-1.5 rounded-full", RISK_STYLES[c.risk].dot)} />
                    {RISK_STYLES[c.risk].label}
                  </span>
                </Td>
                <Td>
                  <Badge tone={c.reviewStatus === "pending" ? "amber" : c.reviewStatus === "reviewed" ? "green" : "neutral"}>
                    {c.reviewStatus.replace("_", " ")}
                  </Badge>
                </Td>
                <Td><Button size="sm" icon={<FileText size={13} />}>Open</Button></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {rows.length === 0 && <div className="p-6"><EmptyState title="No calls match these filters" /></div>}
      </Card>

      <Modal
        open={Boolean(open)}
        onClose={() => setOpenId(null)}
        wide
        title={open ? `${open.patientName} · ${open.outcome}` : ""}
        subtitle={open ? `${fmtDateTime(open.startedAt)} · ${duration(open.durationSeconds)} · ${open.direction} · ${open.agentType} agent` : ""}
        footer={
          open && (
            <>
              {open.recordingAvailable && can("calls.listen") && (
                <Button icon={<Play size={14} />} onClick={() => { audit("call.recording.played", `${open.id} — ${open.patientName}`, "warning"); notify("Recording playback logged to the audit trail"); }}>
                  Play recording
                </Button>
              )}
              <Link href={`/patients/${open.patientId}`}><Button>Open patient</Button></Link>
              {open.reviewStatus === "pending" && can("queue.doctor") && (
                <Button variant="primary" onClick={() => { reviewCall(open.id); audit("call.reviewed", `${open.id}`); notify("Marked reviewed"); setOpenId(null); }}>
                  Mark clinically reviewed
                </Button>
              )}
            </>
          )
        }
      >
        {open && (
          <div className="grid gap-4 md:grid-cols-[1fr_260px]">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-ink-900">Transcript</p>
                <label className="flex items-center gap-1.5 text-xs text-ink-500">
                  <input type="checkbox" checked={showTranslation} onChange={(e) => setShowTranslation(e.target.checked)} className="accent-brand-600" />
                  English
                </label>
              </div>
              <div className="space-y-2.5">
                {open.transcript.map((t, i) => {
                  if (t.speaker === "system")
                    return (
                      <p key={i} className={cx("rounded-lg px-3 py-1.5 text-[11px] font-medium", t.flag === "red" ? "bg-rose-50 text-rose-800" : "bg-ink-100 text-ink-600")}>
                        {t.text}
                      </p>
                    );
                  const isAgent = t.speaker === "agent";
                  return (
                    <div key={i} className={cx("flex gap-2", isAgent ? "" : "flex-row-reverse")}>
                      <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-white", isAgent ? "bg-brand-600" : "bg-ink-400")}>
                        {isAgent ? <Bot size={12} /> : <User size={12} />}
                      </span>
                      <div className={cx("max-w-[80%] rounded-xl px-3 py-2 text-sm", isAgent ? "bg-brand-50" : "bg-ink-100", t.flag === "red" && "ring-2 ring-rose-300")}>
                        <p>{t.text}</p>
                        {showTranslation && t.translation && t.translation !== t.text && (
                          <p className="mt-1 text-[11px] italic text-ink-500">{t.translation}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 rounded-xl border border-ink-200 bg-ink-50 p-3">
                <p className="text-xs font-semibold text-ink-900">AI summary</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-700">{open.summary}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-ink-200 p-3">
                <p className="mb-2 text-xs font-semibold text-ink-900">Structured capture</p>
                <div className="space-y-1.5">
                  {Object.entries(open.structured).map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-2 text-[11px]">
                      <span className="text-ink-500">{k}</span>
                      <span className="text-right font-medium text-ink-900">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-ink-200 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-900">
                  <ShieldCheck size={13} className="text-ink-400" /> Governance record
                </p>
                <div className="space-y-1 text-[11px]">
                  {[
                    ["Call ID", open.id],
                    ["Agent version", open.agentVersion],
                    ["Protocol version", open.protocolVersion],
                    ["Model version", open.modelVersion],
                    ["Recording", open.recordingAvailable ? "retained per policy" : "not recorded (consent)"],
                    ["Cost", inr(open.costRupees)],
                    ["Patient feedback", `${open.sentimentScore}/5`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <span className="text-ink-500">{k}</span>
                      <span className="text-right font-medium text-ink-800">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
