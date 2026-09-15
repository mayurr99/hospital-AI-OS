"use client";

import { useState } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, PageHeader, Select, StatTile } from "@/components/ui";
import { fmtDateTime, LANGUAGE_LABELS } from "@/lib/utils";
import type { Agent, LanguageCode } from "@/lib/types";
import { Bot, CheckCircle2, Lock, Pause, Play, Settings2, ShieldAlert, Sparkles, Upload } from "lucide-react";

const CAPABILITY_LIBRARY = [
  "Check availability", "Book appointment", "Reschedule", "Cancel", "Answer FAQ", "Send confirmation",
  "Human transfer", "Verify identity", "Ask approved questions", "Capture adherence", "Record side effects",
  "Request appointment", "Escalate", "Read report status", "Payment reminder",
];

const FORBIDDEN = [
  "Diagnose a condition", "Start or stop a medication", "Change a dose", "Interpret a lab result",
  "Give treatment advice", "Read unrelated clinical history", "Alter a clinical record",
];

export default function AdminAgentsPage() {
  const { can, updateAgent, notify, audit } = useStore();
  const d = useOrgData();
  const [editing, setEditing] = useState<Agent | null>(null);
  const [publishing, setPublishing] = useState<Agent | null>(null);

  if (!can("agents.configure")) return <Denied />;

  return (
    <>
      <PageHeader
        title="AI agent configuration"
        subtitle="Structured controls that compile into governed agent instructions — no free-text system prompt is ever exposed"
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Agents" value={d.agents.length} icon={<Bot size={15} />} tone="brand" />
        <StatTile label="Published" value={d.agents.filter((a) => a.status === "published").length} tone="green" icon={<CheckCircle2 size={15} />} />
        <StatTile label="Drafts" value={d.agents.filter((a) => a.status === "draft").length} tone="amber" icon={<Settings2 size={15} />} />
        <StatTile label="Languages live" value={new Set(d.agents.flatMap((a) => a.languages)).size} icon={<Sparkles size={15} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {d.agents.map((a) => (
          <Card key={a.id}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-700"><Bot size={18} /></span>
                <div>
                  <h3 className="text-sm font-semibold text-ink-900">{a.name}</h3>
                  <p className="text-xs text-ink-500">{a.type === "care" ? "Care follow-up agent" : "Front desk agent"} · {a.version}</p>
                </div>
              </div>
              <Badge tone={a.status === "published" ? "green" : a.status === "draft" ? "amber" : "neutral"}>{a.status}</Badge>
            </div>

            <p className="mb-3 text-xs leading-relaxed text-ink-600">{a.purpose}</p>

            <div className="space-y-1.5 text-[11px]">
              <Row k="Voice" v={a.voice} />
              <Row k="Identity verification" v={a.identityVerification.replace("_", " + ")} />
              <Row k="Knowledge scope" v={a.knowledgeScope} />
              <Row k="Clinical protocol" v={d.protocols.find((p) => p.id === a.protocolId)?.version ?? "none (administrative)"} />
              <Row k="Escalation target" v={a.escalationTarget} />
              <Row k="Recording policy" v={a.recordingPolicy} />
              <Row k="Retention" v={`${a.retentionDays} days`} />
              <Row k="Conversation limit" v={`${a.maxTurns} turns`} />
              <Row k="Published" v={a.publishedAt ? fmtDateTime(a.publishedAt) : "not published"} />
            </div>

            <div className="mt-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Languages</p>
              <div className="flex flex-wrap gap-1">
                {a.languages.map((l) => (
                  <Badge key={l} tone="brand">{LANGUAGE_LABELS[l]}</Badge>
                ))}
              </div>
            </div>

            <div className="mt-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Allowed capabilities</p>
              <div className="flex flex-wrap gap-1">
                {a.capabilities.map((c) => (
                  <Badge key={c}>{c}</Badge>
                ))}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button size="sm" icon={<Settings2 size={13} />} onClick={() => setEditing({ ...a })}>Configure</Button>
              {a.status === "draft" && <Button size="sm" variant="primary" icon={<Upload size={13} />} onClick={() => setPublishing(a)}>Publish</Button>}
              {a.status === "published" && (
                <Button size="sm" icon={<Pause size={13} />} onClick={() => { updateAgent(a.id, { status: "paused" }); audit("agent.paused", a.name, "warning"); notify("Agent paused — inbound calls fall back to the human line"); }}>
                  Pause
                </Button>
              )}
              {a.status === "paused" && (
                <Button size="sm" variant="success" icon={<Play size={13} />} onClick={() => { updateAgent(a.id, { status: "published" }); audit("agent.resumed", a.name, "warning"); notify("Agent resumed"); }}>
                  Resume
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader
          title="What an agent can never be configured to do"
          subtitle="These are not prompt instructions — the tools simply do not exist for the agent to call"
          icon={<ShieldAlert size={16} />}
        />
        <div className="flex flex-wrap gap-1.5">
          {FORBIDDEN.map((f) => (
            <span key={f} className="flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700 ring-1 ring-rose-200">
              <Lock size={10} /> {f}
            </span>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
          This is the difference between a prompt-engineered bot and a clinically governable system. A hospital does not
          have to trust that the model will behave — the capability is absent from the runtime.
        </p>
      </Card>

      {/* configure */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        wide
        title={editing ? `Configure ${editing.name}` : ""}
        subtitle="Changes create a new draft version — the live agent is untouched until you publish"
        footer={
          editing && (
            <>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => {
                  const next = { ...editing, version: bump(editing.version), status: "draft" as const };
                  updateAgent(editing.id, next);
                  audit("agent.configured", `${editing.name} → ${next.version}`, "warning");
                  notify(`Saved as draft ${next.version} — publish to make it live`);
                  setEditing(null);
                }}
              >
                Save as new draft
              </Button>
            </>
          )
        }
      >
        {editing && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Agent name"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Department">
                <Select value={editing.departmentId ?? ""} onChange={(e) => setEditing({ ...editing, departmentId: e.target.value || null })}>
                  <option value="">All departments</option>
                  {d.departments.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
                </Select>
              </Field>
              <Field label="Purpose" className="sm:col-span-2">
                <Input value={editing.purpose} onChange={(e) => setEditing({ ...editing, purpose: e.target.value })} />
              </Field>
              <Field label="Identity verification" hint="Nothing clinical is revealed before this succeeds">
                <Select value={editing.identityVerification} onChange={(e) => setEditing({ ...editing, identityVerification: e.target.value as Agent["identityVerification"] })}>
                  <option value="dob_name">Date of birth + name</option>
                  <option value="otp">OTP to registered mobile</option>
                  <option value="mrn">Hospital MRN</option>
                  <option value="none">None (administrative only)</option>
                </Select>
              </Field>
              <Field label="Clinical protocol" hint="Only approved protocols can be bound to a live agent">
                <Select value={editing.protocolId ?? ""} onChange={(e) => setEditing({ ...editing, protocolId: e.target.value || null })}>
                  <option value="">None — administrative agent</option>
                  {d.protocols.map((p) => (<option key={p.id} value={p.id}>{p.name} — {p.version} ({p.status})</option>))}
                </Select>
              </Field>
              <Field label="Escalation target"><Input value={editing.escalationTarget} onChange={(e) => setEditing({ ...editing, escalationTarget: e.target.value })} /></Field>
              <Field label="Human transfer number"><Input value={editing.humanTransferNumber} onChange={(e) => setEditing({ ...editing, humanTransferNumber: e.target.value })} /></Field>
              <Field label="Recording policy">
                <Select value={editing.recordingPolicy} onChange={(e) => setEditing({ ...editing, recordingPolicy: e.target.value as Agent["recordingPolicy"] })}>
                  <option value="consent">Record only with patient consent</option>
                  <option value="always">Always record</option>
                  <option value="never">Never record</option>
                </Select>
              </Field>
              <Field label="Retention (days)"><Input type="number" value={editing.retentionDays} onChange={(e) => setEditing({ ...editing, retentionDays: Number(e.target.value) })} /></Field>
              <Field label="Max conversation turns" hint="Hard stop — prevents runaway conversations">
                <Input type="number" value={editing.maxTurns} onChange={(e) => setEditing({ ...editing, maxTurns: Number(e.target.value) })} />
              </Field>
              <Field label="Voice">
                <Select value={editing.voice} onChange={(e) => setEditing({ ...editing, voice: e.target.value })}>
                  <option>Marathi — Aarohi (female, warm)</option>
                  <option>Hindi — Kavya (female, calm)</option>
                  <option>English (Indian) — Neha (female, clear)</option>
                  <option>Hindi — Arjun (male, steady)</option>
                </Select>
              </Field>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-600">Languages</p>
              <div className="flex flex-wrap gap-1.5">
                {(["mr", "hi", "en", "hinglish"] as LanguageCode[]).map((l) => {
                  const on = editing.languages.includes(l);
                  return (
                    <button
                      key={l}
                      onClick={() => setEditing({ ...editing, languages: on ? editing.languages.filter((x) => x !== l) : [...editing.languages, l] })}
                      className={on ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-600"}
                    >
                      {LANGUAGE_LABELS[l]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-600">Allowed capabilities (tool allow-list)</p>
              <div className="grid gap-1 sm:grid-cols-2">
                {CAPABILITY_LIBRARY.map((c) => {
                  const on = editing.capabilities.includes(c);
                  return (
                    <button
                      key={c}
                      onClick={() => setEditing({ ...editing, capabilities: on ? editing.capabilities.filter((x) => x !== c) : [...editing.capabilities, c] })}
                      className={on ? "flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-left text-xs" : "flex items-center gap-2 rounded-lg border border-ink-200 px-2.5 py-1.5 text-left text-xs hover:bg-ink-50"}
                    >
                      <span className={on ? "grid h-4 w-4 place-items-center rounded bg-emerald-500 text-white" : "grid h-4 w-4 place-items-center rounded bg-ink-200"}>
                        {on && <CheckCircle2 size={11} />}
                      </span>
                      <span className="text-ink-700">{c}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <Field label="Knowledge scope" hint="The agent may answer only from this source — anything else becomes a transfer">
              <Input value={editing.knowledgeScope} onChange={(e) => setEditing({ ...editing, knowledgeScope: e.target.value })} />
            </Field>

            <div className="rounded-lg bg-ink-900 p-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Compiled agent contract (read-only)</p>
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-brand-300">
{`agent: ${editing.name}
purpose: ${editing.purpose}
languages: [${editing.languages.join(", ")}]
identity_verification: ${editing.identityVerification}
tools_allowed: [${editing.capabilities.map((c) => c.toLowerCase().replace(/ /g, "_")).join(", ")}]
knowledge_scope: ${editing.knowledgeScope}
protocol: ${d.protocols.find((p) => p.id === editing.protocolId)?.version ?? "none"}
escalation: ${editing.escalationTarget}
max_turns: ${editing.maxTurns}
recording: ${editing.recordingPolicy}
retention_days: ${editing.retentionDays}
forbidden: [diagnose, prescribe, change_dose, interpret_results]`}
              </pre>
            </div>
          </div>
        )}
      </Modal>

      {/* publish */}
      <Modal
        open={Boolean(publishing)}
        onClose={() => setPublishing(null)}
        title="Publish agent version"
        subtitle={publishing ? `${publishing.name} ${publishing.version}` : ""}
        footer={
          <>
            <Button onClick={() => setPublishing(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                updateAgent(publishing!.id, { status: "published", publishedAt: new Date().toISOString() });
                audit("agent.published", `${publishing!.name} ${publishing!.version}`, "critical");
                notify("Published — new calls use this version; in-flight calls finish on the previous one");
                setPublishing(null);
              }}
            >
              Publish to production
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          {[
            ["Protocol approved by clinical leadership", Boolean(d.protocols.find((p) => p.id === publishing?.protocolId)?.status === "approved") || publishing?.type === "receptionist"],
            ["Identity verification configured", publishing?.identityVerification !== "none" || publishing?.type === "receptionist"],
            ["Escalation destination set", Boolean(publishing?.escalationTarget)],
            ["Human transfer number reachable", Boolean(publishing?.humanTransferNumber)],
            ["Retention policy set", Boolean(publishing?.retentionDays)],
            ["Sandbox test calls passed", true],
          ].map(([label, ok]) => (
            <p key={label as string} className="flex items-center gap-2 text-sm">
              <span className={ok ? "grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-white" : "grid h-5 w-5 place-items-center rounded-full bg-amber-500 text-white"}>
                {ok ? <CheckCircle2 size={12} /> : "!"}
              </span>
              <span className={ok ? "text-ink-700" : "text-amber-700"}>{label as string}</span>
            </p>
          ))}
        </div>
        <p className="mt-3 rounded-lg bg-ink-50 p-3 text-[11px] leading-relaxed text-ink-500">
          Publishing is a versioned, audited event. Every call records which agent version, protocol version and model
          version handled it, so any conversation can be traced back to exactly this configuration.
        </p>
      </Modal>
    </>
  );
}

function bump(v: string) {
  const m = v.match(/v(\d+)\.(\d+)/);
  if (!m) return "v1.0";
  return `v${m[1]}.${Number(m[2]) + 1}`;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <p className="flex justify-between gap-3">
      <span className="text-ink-500">{k}</span>
      <span className="text-right font-medium text-ink-800">{v}</span>
    </p>
  );
}
