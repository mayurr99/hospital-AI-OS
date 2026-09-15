"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useOrgData, useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import {
  Badge, Button, Card, CardHeader, Confirm, Field, Input, Modal, PageHeader, Progress, Select, StatTile, Table,
  Td, Th, Toggle, Tr,
} from "@/components/ui";
import { fmtDate, LANGUAGE_LABELS, pct } from "@/lib/utils";
import type { LanguageCode } from "@/lib/types";
import { CheckCircle2, Megaphone, Pause, Play, Plus, Target, Users } from "lucide-react";

export default function CampaignsPage() {
  const { can, updateCampaign, notify, createRecord } = useStore();
  const d = useOrgData();
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  /** Id of the campaign awaiting a start confirmation, if any. */
  const [starting, setStarting] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", deptId: "", protocolId: "", window: "10:00 – 18:00", retry: "3 attempts, 4h apart",
    languages: ["mr", "hi"] as LanguageCode[], cohort: "Discharged in the last 3 days", consentOnly: true, size: 60,
  });

  /** Patients in the chosen department who may lawfully be called. */
  const cohortSize = useMemo(
    () =>
      form.deptId
        ? d.patients.filter(
            (p) => p.departmentId === form.deptId && (!form.consentOnly || p.consent?.clinicalCalls !== false),
          ).length
        : 0,
    [d.patients, form.deptId, form.consentOnly],
  );

  if (!can("campaigns.manage")) return <Denied />;

  const totals = d.campaigns.reduce(
    (acc, c) => ({
      patients: acc.patients + c.totalPatients,
      called: acc.called + c.called,
      connected: acc.connected + c.connected,
      completed: acc.completed + c.completed,
      escalated: acc.escalated + c.escalated,
    }),
    { patients: 0, called: 0, connected: 0, completed: 0, escalated: 0 },
  );

  return (
    <>
      <PageHeader
        title="Follow-up campaigns"
        subtitle="Patient cohorts called by the care agent under a hospital-approved protocol and consent window"
        actions={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>New campaign</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Patients in campaigns" value={totals.patients} icon={<Users size={15} />} tone="brand" />
        <StatTile label="Reached" value={totals.connected} sub={`${pct(totals.connected, totals.called)} of attempts`} icon={<Target size={15} />} />
        <StatTile label="Completed protocols" value={totals.completed} sub={`${pct(totals.completed, totals.patients)} coverage`} icon={<CheckCircle2 size={15} />} tone="green" />
        <StatTile label="Escalated to clinicians" value={totals.escalated} tone="amber" icon={<Megaphone size={15} />} />
        <StatTile label="Running now" value={d.campaigns.filter((c) => c.status === "running").length} sub={`${d.campaigns.length} total`} icon={<Play size={15} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {d.campaigns.map((c) => {
          const dept = d.departments.find((x) => x.id === c.departmentId);
          const protocol = d.protocols.find((p) => p.id === c.protocolId);
          return (
            <Card key={c.id}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-ink-900">{c.name}</h3>
                  <p className="mt-0.5 text-xs text-ink-500">{c.cohortDescription}</p>
                </div>
                <Badge tone={c.status === "running" ? "green" : c.status === "paused" ? "amber" : c.status === "scheduled" ? "blue" : "neutral"}>
                  {c.status}
                </Badge>
              </div>

              <div className="mb-3 grid grid-cols-4 gap-2 text-center">
                {[
                  ["Cohort", c.totalPatients],
                  ["Called", c.called],
                  ["Completed", c.completed],
                  ["Escalated", c.escalated],
                ].map(([k, v]) => (
                  <div key={k as string} className="rounded-lg bg-ink-50 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-ink-400">{k}</p>
                    <p className="text-sm font-semibold text-ink-900 tabular-nums">{v}</p>
                  </div>
                ))}
              </div>

              <Progress value={c.completed} max={c.totalPatients} tone={c.escalated > 5 ? "amber" : "brand"} />
              <p className="mt-1.5 text-[11px] text-ink-500">
                {pct(c.completed, c.totalPatients)} of the cohort completed the protocol
              </p>

              <div className="mt-3 space-y-1 text-[11px] text-ink-500">
                <p className="flex justify-between"><span>Department</span><span className="font-medium text-ink-800">{dept?.name}</span></p>
                <p className="flex justify-between"><span>Protocol</span><span className="font-medium text-ink-800">{protocol?.version ?? c.protocolId}</span></p>
                <p className="flex justify-between"><span>Call window</span><span className="font-medium text-ink-800">{c.window}</span></p>
                <p className="flex justify-between"><span>Retry policy</span><span className="font-medium text-ink-800">{c.retryPolicy}</span></p>
                <p className="flex justify-between"><span>Started</span><span className="font-medium text-ink-800">{fmtDate(c.startDate)}</span></p>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {c.languages.map((l) => (
                  <Badge key={l} tone="brand">{LANGUAGE_LABELS[l].split(" ")[0]}</Badge>
                ))}
                <div className="ml-auto flex gap-1.5">
                  {c.status === "running" ? (
                    <Button size="sm" icon={<Pause size={13} />} onClick={() => { updateCampaign(c.id, { status: "paused" }); notify("Campaign paused — no further calls will be placed"); }}>
                      Pause
                    </Button>
                  ) : c.status === "paused" || c.status === "scheduled" ? (
                    /* Starting a campaign dials a whole cohort of real patients.
                       That is not a one-click action. */
                    <Button size="sm" variant="primary" icon={<Play size={13} />} onClick={() => setStarting(c.id)}>
                      {c.status === "paused" ? "Resume" : "Start now"}
                    </Button>
                  ) : null}
                  <Link href="/calls"><Button size="sm" variant="ghost">Calls</Button></Link>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-4" padded={false}>
        <div className="px-5 pt-5">
          <CardHeader title="Campaign safety rules" subtitle="Applied by the platform, not by the agent's own judgement" icon={<CheckCircle2 size={16} />} />
        </div>
        <Table>
          <thead>
            <tr><Th>Rule</Th><Th>Behaviour</Th></tr>
          </thead>
          <tbody>
            {[
              ["Consent gate", "Patients who have withdrawn clinical-call consent are excluded from every cohort automatically, even if imported."],
              ["Call window", "No outbound call is placed outside the configured hours for that campaign."],
              ["Retry policy", "Attempts are capped; after the final attempt the patient moves to the unreachable queue for a human."],
              ["Protocol binding", "A campaign cannot run against a draft protocol — only an approved, versioned one."],
              ["Marketing separation", "Clinical follow-up permission never implies promotional permission."],
              ["Escalation routing", "Red-flag results bypass the campaign entirely and go straight to the clinical escalation queue."],
            ].map(([r, b]) => (
              <Tr key={r}>
                <Td className="w-52 font-medium text-ink-900">{r}</Td>
                <Td className="text-xs">{b}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {(() => {
        const c = d.campaigns.find((x) => x.id === starting);
        return (
          <Confirm
            open={Boolean(c)}
            onCancel={() => setStarting(null)}
            tone="primary"
            confirmLabel={c?.status === "paused" ? "Resume calling" : "Start calling"}
            title={c?.status === "paused" ? "Resume this campaign?" : "Start calling this cohort?"}
            body={
              c && (
                <>
                  <b>{c.name}</b> will begin placing AI follow-up calls to{" "}
                  <b>{(c.totalPatients - c.called).toLocaleString("en-IN")} patients</b> who have not yet been
                  called, inside the {c.window} window, under protocol{" "}
                  {d.protocols.find((p) => p.id === c.protocolId)?.version ?? c.protocolId}.
                  <p className="mt-2 text-ink-500">
                    Patients who have withdrawn clinical-call consent are excluded automatically. You can pause
                    the campaign at any time.
                  </p>
                </>
              )
            }
            onConfirm={() => {
              if (!c) return;
              updateCampaign(c.id, { status: "running" });
              notify("Campaign running inside the configured consent window");
              setStarting(null);
            }}
          />
        );
      })()}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New follow-up campaign"
        subtitle="Cohort, protocol and call policy"
        wide
        footer={
          <>
            <Button onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button
              variant="primary"
              disabled={creating || !form.name || !form.deptId || !form.protocolId}
              onClick={async () => {
                /* This used to only raise a toast: the campaign was never
                   created and the list never changed. It is a real write now. */
                setCreating(true);
                const created = await createRecord("campaign", {
                  name: form.name.trim(),
                  agentType: "care",
                  protocolId: form.protocolId,
                  departmentId: form.deptId,
                  cohortDescription: form.cohort,
                  totalPatients: cohortSize,
                  called: 0, connected: 0, completed: 0, escalated: 0,
                  languages: form.languages,
                  window: form.window,
                  retryPolicy: form.retry,
                  status: "draft",
                  startDate: new Date().toISOString(),
                });
                setCreating(false);
                if (!created) return;              /* the store has already explained why */
                notify("Campaign saved as a draft — it will not dial until you start it");
                setCreateOpen(false);
                setForm({
                  name: "", deptId: "", protocolId: "", window: "10:00 – 18:00", retry: "3 attempts, 4h apart",
                  languages: ["mr", "hi"], cohort: "Discharged in the last 3 days", consentOnly: true, size: 60,
                });
              }}
            >
              {creating ? "Creating…" : "Create as draft"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Campaign name" className="sm:col-span-2">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Cardiac post-discharge — Day 7" />
          </Field>
          <Field label="Department">
            <Select value={form.deptId} onChange={(e) => setForm({ ...form, deptId: e.target.value })}>
              <option value="">Select…</option>
              {d.departments.filter((x) => x.type === "clinical").map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Approved protocol" hint="Draft protocols cannot be used for live calling">
            <Select value={form.protocolId} onChange={(e) => setForm({ ...form, protocolId: e.target.value })}>
              <option value="">Select…</option>
              {d.protocols.filter((p) => p.status === "approved").map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {p.version}</option>
              ))}
            </Select>
          </Field>
          <Field label="Cohort definition" className="sm:col-span-2">
            <Select value={form.cohort} onChange={(e) => setForm({ ...form, cohort: e.target.value })}>
              <option>Discharged in the last 3 days</option>
              <option>Discharged 7 days ago</option>
              <option>Post-op day 14</option>
              <option>Appointments in the next 48 hours (reminder)</option>
              <option>Chronic patients with no contact in 30 days</option>
              <option>Imported from Excel / CSV</option>
            </Select>
          </Field>
          <Field label="Call window">
            <Input value={form.window} onChange={(e) => setForm({ ...form, window: e.target.value })} />
          </Field>
          <Field label="Retry policy">
            <Select value={form.retry} onChange={(e) => setForm({ ...form, retry: e.target.value })}>
              <option>2 attempts, 6h apart</option>
              <option>3 attempts, 4h apart</option>
              <option>3 attempts across 2 days</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <p className="mb-1 text-xs font-medium text-ink-600">Languages</p>
            <div className="flex flex-wrap gap-1.5">
              {(["mr", "hi", "en", "hinglish"] as LanguageCode[]).map((l) => {
                const on = form.languages.includes(l);
                return (
                  <button
                    key={l}
                    onClick={() => setForm({ ...form, languages: on ? form.languages.filter((x) => x !== l) : [...form.languages, l] })}
                    className={on ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-600"}
                  >
                    {LANGUAGE_LABELS[l]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="sm:col-span-2 rounded-lg border border-ink-200 px-3">
            <Toggle
              label="Exclude patients without clinical-call consent"
              description="Strongly recommended — this is enforced by the consent engine regardless"
              checked={form.consentOnly}
              onChange={(v) => setForm({ ...form, consentOnly: v })}
            />
          </div>
          {/*
            Counted from the patients actually loaded, matching the department
            and the consent rule chosen above. It used to print a hardcoded 60
            regardless of what was selected, which made the cost figure beside
            it meaningless.
          */}
          <div className="sm:col-span-2 rounded-lg bg-brand-50 p-3 text-xs text-brand-900 ring-1 ring-brand-200">
            {form.deptId ? (
              <>
                Matching patients loaded in this workspace: <strong>{cohortSize}</strong>
                {form.consentOnly && " (patients without clinical-call consent excluded)"} · approximate voice cost{" "}
                <strong>₹{Math.round(cohortSize * 2.2 * 4.2)}</strong> at the current blended rate.
                <span className="mt-1 block text-brand-700">
                  The exact cohort is resolved from the whole register when the campaign starts.
                </span>
              </>
            ) : (
              <>Choose a department to see how many patients this cohort would reach.</>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
