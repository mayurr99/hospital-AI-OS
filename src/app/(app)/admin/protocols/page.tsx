"use client";

import { useState } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, Modal, PageHeader, StatTile, Table, Td, Th, Tr } from "@/components/ui";
import { fmtDateTime, LANGUAGE_LABELS } from "@/lib/utils";
import type { LanguageCode, Protocol } from "@/lib/types";
import { AlertTriangle, CheckCircle2, FileCheck2, GitBranch, ShieldCheck, Siren, Stethoscope } from "lucide-react";

export default function AdminProtocolsPage() {
  const { can, updateProtocol, notify, audit, currentUser } = useStore();
  const d = useOrgData();
  const [open, setOpen] = useState<Protocol | null>(null);
  const [approving, setApproving] = useState<Protocol | null>(null);

  if (!can("protocols.configure")) return <Denied />;

  return (
    <>
      <PageHeader
        title="Clinical protocols"
        subtitle="The hospital's own questionnaires, red flags and escalation rules — versioned, approved and enforced deterministically"
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Protocols" value={d.protocols.length} icon={<FileCheck2 size={15} />} tone="brand" />
        <StatTile label="Approved" value={d.protocols.filter((p) => p.status === "approved").length} tone="green" icon={<CheckCircle2 size={15} />} />
        <StatTile label="Awaiting sign-off" value={d.protocols.filter((p) => p.status === "draft").length} tone="amber" icon={<Stethoscope size={15} />} />
        <StatTile label="Red-flag rules" value={d.protocols.reduce((s, p) => s + p.redFlags.length, 0)} tone="red" icon={<Siren size={15} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {d.protocols.map((p) => (
          <Card key={p.id}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink-900">{p.name}</h3>
                <p className="text-xs text-ink-500">
                  {d.departments.find((x) => x.id === p.departmentId)?.name} · <span className="font-mono">{p.version}</span>
                </p>
              </div>
              <Badge tone={p.status === "approved" ? "green" : p.status === "draft" ? "amber" : "neutral"}>{p.status}</Badge>
            </div>

            <div className="space-y-1.5 text-[11px]">
              <p className="flex justify-between"><span className="text-ink-500">Questions</span><span className="font-medium text-ink-800">{p.questions.length}</span></p>
              <p className="flex justify-between"><span className="text-ink-500">Red-flag rules</span><span className="font-medium text-ink-800">{p.redFlags.length}</span></p>
              <p className="flex justify-between"><span className="text-ink-500">Escalation SLA</span><span className="font-medium text-ink-800">{p.slaMinutes} minutes</span></p>
              <p className="flex justify-between gap-3"><span className="shrink-0 text-ink-500">Escalates to</span><span className="text-right font-medium text-ink-800">{p.escalationTarget}</span></p>
              <p className="flex justify-between gap-3"><span className="shrink-0 text-ink-500">Approved by</span><span className="text-right font-medium text-ink-800">{p.approvedBy ?? "— not signed off"}</span></p>
              {p.approvedAt && <p className="flex justify-between"><span className="text-ink-500">Approved on</span><span className="font-medium text-ink-800">{fmtDateTime(p.approvedAt)}</span></p>}
            </div>

            <div className="mt-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Red flags</p>
              <div className="flex flex-wrap gap-1">
                {p.redFlags.map((r) => (
                  <span key={r} className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700 ring-1 ring-rose-200">{r}</span>
                ))}
              </div>
            </div>

            <div className="mt-3 flex gap-1.5">
              <Button size="sm" onClick={() => setOpen(p)}>View questionnaire</Button>
              {p.status === "draft" && <Button size="sm" variant="primary" onClick={() => setApproving(p)}>Send for clinical sign-off</Button>}
            </div>
          </Card>
        ))}
        {d.protocols.length === 0 && <EmptyState title="No protocols configured for this hospital" />}
      </div>

      <Card className="mt-4">
        <CardHeader title="Two-layer safety model" subtitle="Why a language model is never the thing deciding clinical risk" icon={<ShieldCheck size={16} />} />
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4">
            <p className="text-sm font-semibold text-ink-900">Deterministic protocol engine</p>
            <ul className="mt-2 space-y-1 text-xs text-ink-700">
              <li>· Hospital-defined questionnaire, in the hospital&apos;s words</li>
              <li>· Hard red-flag rules with explicit thresholds</li>
              <li>· Escalation destination and SLA per protocol</li>
              <li>· The allowed set of next steps</li>
              <li>· Versioned, approved and immutable once live</li>
            </ul>
          </div>
          <div className="rounded-xl border border-ink-200 p-4">
            <p className="text-sm font-semibold text-ink-900">The language model</p>
            <ul className="mt-2 space-y-1 text-xs text-ink-700">
              <li>· Understands natural, code-mixed speech</li>
              <li>· Asks the approved follow-up in the patient&apos;s language</li>
              <li>· Extracts structured fields against a fixed schema</li>
              <li>· Writes the summary a clinician reads</li>
              <li>· Never decides whether something is urgent</li>
            </ul>
          </div>
        </div>
      </Card>

      {/* questionnaire viewer */}
      <Modal
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        wide
        title={open?.name ?? ""}
        subtitle={open ? `${open.version} · ${open.status} · escalates to ${open.escalationTarget} within ${open.slaMinutes} min` : ""}
        footer={<Button onClick={() => setOpen(null)}>Close</Button>}
      >
        {open && (
          <div className="space-y-4">
            <Table>
              <thead>
                <tr><Th>#</Th><Th>Question (English)</Th><Th>Marathi</Th><Th>Answer type</Th><Th>Triggers</Th></tr>
              </thead>
              <tbody>
                {open.questions.map((q, i) => (
                  <Tr key={q.id}>
                    <Td className="w-8 text-ink-400">{i + 1}</Td>
                    <Td className="text-ink-900">{q.text.en}</Td>
                    <Td className="text-ink-700">{q.text.mr}</Td>
                    <Td><Badge>{q.answerType}</Badge></Td>
                    <Td>
                      <div className="flex flex-col gap-0.5">
                        {q.redIf && <Badge tone="red">red if {q.redIf}</Badge>}
                        {q.amberIf && <Badge tone="amber">amber if {q.amberIf}</Badge>}
                        {!q.redIf && !q.amberIf && <span className="text-[11px] text-ink-400">record only</span>}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>

            <div>
              <p className="mb-1.5 text-sm font-semibold text-ink-900">Translations held for every question</p>
              <div className="flex flex-wrap gap-1.5">
                {(["mr", "hi", "en", "hinglish"] as LanguageCode[]).map((l) => (
                  <Badge key={l} tone="brand">{LANGUAGE_LABELS[l]}</Badge>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-ink-500">
                Clinical wording is translated once and approved once — the agent does not improvise a translation at call
                time, which is how meaning drifts.
              </p>
            </div>

            <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-rose-900">
                <AlertTriangle size={14} /> Red-flag rules
              </p>
              <ul className="space-y-1 text-xs text-rose-800">
                {open.redFlags.map((r) => (
                  <li key={r}>· {r}</li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-rose-700">
                On any match the routine flow stops, a high-priority event is created and {open.escalationTarget} is
                alerted with a {open.slaMinutes}-minute acknowledgement SLA.
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* approval */}
      <Modal
        open={Boolean(approving)}
        onClose={() => setApproving(null)}
        title="Clinical sign-off"
        subtitle={approving ? `${approving.name} ${approving.version}` : ""}
        footer={
          <>
            <Button onClick={() => setApproving(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                updateProtocol(approving!.id, { status: "approved", approvedBy: currentUser?.name ?? "Clinical lead", approvedAt: new Date().toISOString() });
                audit("protocol.approved", `${approving!.name} ${approving!.version} by ${currentUser?.name}`, "critical");
                notify("Protocol approved and locked — it can now be bound to a live agent");
                setApproving(null);
              }}
            >
              Approve & lock version
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-600">
          Approving records your name against this exact version of the questionnaire, red flags and escalation rules. An
          approved version cannot be edited — changes create a new version that needs its own sign-off.
        </p>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
          <GitBranch size={14} className="text-ink-400" />
          Every call made under this protocol will carry <code className="font-mono">{approving?.version}</code> in its
          governance record.
        </div>
      </Modal>
    </>
  );
}
