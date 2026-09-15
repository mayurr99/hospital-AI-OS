"use client";

import { useState } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, Modal, PageHeader, StatTile, Table, Td, Th, Tr } from "@/components/ui";
import { relative } from "@/lib/utils";
import type { Integration } from "@/lib/types";
import { AlertTriangle, CheckCircle2, Database, GitCompareArrows, Plug, RefreshCw, Server, Webhook } from "lucide-react";

const FHIR_MAP = [
  ["Patient", "Patient", "Identity, contact, preferred language"],
  ["Appointment", "Appointment", "Slot, status, participant"],
  ["Visit / admission", "Encounter", "Class, period, discharge disposition"],
  ["Patient-reported answers", "QuestionnaireResponse", "Structured follow-up capture"],
  ["Observations", "Observation", "Vitals and patient-reported measures"],
  ["Medication context", "MedicationRequest / MedicationStatement", "Read-only adherence context"],
  ["Care pathway", "CarePlan", "Follow-up programme membership"],
  ["Call summary document", "Composition / DocumentReference", "Structured summary written back"],
];

export default function IntegrationsPage() {
  const { can, notify, audit } = useStore();
  const d = useOrgData();
  const [open, setOpen] = useState<Integration | null>(null);

  if (!can("integrations.configure")) return <Denied />;

  const live = d.integrations.filter((i) => i.status === "live");
  const errored = d.integrations.filter((i) => i.status === "error");

  return (
    <>
      <PageHeader
        title="Integrations & FHIR"
        subtitle="We add an intelligent patient-engagement layer to your existing HIS — we do not replace it"
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Connected" value={live.length} sub={`of ${d.integrations.length} configured`} tone="green" icon={<Plug size={15} />} />
        <StatTile label="Records synced" value={d.integrations.reduce((s, i) => s + i.recordsSynced, 0).toLocaleString("en-IN")} icon={<Database size={15} />} tone="brand" />
        <StatTile label="In sandbox" value={d.integrations.filter((i) => i.status === "sandbox").length} tone="amber" icon={<Server size={15} />} />
        <StatTile label="Errored" value={errored.length} tone={errored.length ? "red" : "green"} icon={<AlertTriangle size={15} />} />
      </div>

      {errored.length > 0 && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-900">
          <AlertTriangle size={15} className="mr-1.5 inline" />
          <strong>{errored[0].name}</strong> is failing — {errored[0].endpoint} returned an error. Follow-up plans created
          from discharge events are delayed. The platform is queueing them for reconciliation rather than dropping them.
        </div>
      )}

      <Card padded={false}>
        <Table>
          <thead>
            <tr><Th>Integration</Th><Th>Vendor</Th><Th>Kind</Th><Th>Direction</Th><Th>Last sync</Th><Th>Records</Th><Th>Status</Th><Th /></tr>
          </thead>
          <tbody>
            {d.integrations.map((i) => (
              <Tr key={i.id} onClick={() => setOpen(i)}>
                <Td>
                  <span className="block text-sm font-medium text-ink-900">{i.name}</span>
                  <span className="block font-mono text-[10px] text-ink-400">{i.endpoint}</span>
                </Td>
                <Td className="text-xs">{i.vendor}</Td>
                <Td><Badge tone="brand">{i.kind.toUpperCase()}</Badge></Td>
                <Td><Badge>{i.direction}</Badge></Td>
                <Td className="text-xs text-ink-500">{i.lastSync ? relative(i.lastSync) : "never"}</Td>
                <Td className="tabular-nums text-xs">{i.recordsSynced.toLocaleString("en-IN")}</Td>
                <Td>
                  <Badge tone={i.status === "live" ? "green" : i.status === "sandbox" ? "amber" : i.status === "error" ? "red" : "neutral"}>
                    {i.status.replace("_", " ")}
                  </Badge>
                </Td>
                <Td><Button size="sm">Details</Button></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="FHIR resource mapping" subtitle="How hospital concepts map onto R4 resources" icon={<GitCompareArrows size={16} />} />
          <Table>
            <thead><tr><Th>Hospital concept</Th><Th>FHIR resource</Th><Th>Fields used</Th></tr></thead>
            <tbody>
              {FHIR_MAP.map(([a, b, c]) => (
                <Tr key={a}>
                  <Td className="font-medium text-ink-900">{a}</Td>
                  <Td className="font-mono text-xs text-brand-700">{b}</Td>
                  <Td className="text-xs text-ink-500">{c}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Event contract" subtitle="What the platform emits and consumes" icon={<Webhook size={16} />} />
          <div className="space-y-1.5">
            {[
              ["PATIENT_DISCHARGED", "in", "Creates the follow-up plan and schedules the first call"],
              ["APPOINTMENT_CREATED", "out", "Pushed to the HIS with an idempotency key"],
              ["FOLLOWUP_DUE", "internal", "Durable timer fires; the call is placed inside the consent window"],
              ["CALL_COMPLETED", "out", "Structured summary written back as a document reference"],
              ["REVIEW_REQUIRED", "internal", "Creates the care-team task"],
              ["RED_FLAG_DETECTED", "out", "High-priority escalation; also notified over the hospital's paging webhook"],
              ["PATIENT_UNREACHABLE", "internal", "Retry policy, then the unreachable queue"],
              ["EXPORT_REQUESTED", "internal", "Governed report generation with an audit event"],
            ].map(([e, dir, desc]) => (
              <div key={e} className="flex items-start gap-2 rounded-lg border border-ink-200 px-2.5 py-2">
                <Badge tone={dir === "out" ? "brand" : dir === "in" ? "blue" : "neutral"}>{dir}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[11px] font-semibold text-ink-900">{e}</p>
                  <p className="text-[11px] text-ink-500">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Integration maturity path" subtitle="Hospitals start simple and deepen over time" icon={<Server size={16} />} />
        <div className="grid gap-3 md:grid-cols-4">
          {[
            ["Stage 1 — Excel/CSV", "Secure import of discharge and follow-up lists, governed exports back. Enough to run a real pilot in days."],
            ["Stage 2 — Read APIs", "Live availability and patient lookup from the HIS. Bookings still confirmed by staff."],
            ["Stage 3 — Bidirectional", "Appointments written back with idempotency, summaries posted as documents, ADT consumed over HL7 or FHIR."],
            ["Stage 4 — Ecosystem", "SSO, SIEM, ABHA/ABDM linking and warehouse feeds. Reviewed and re-validated at deployment time."],
          ].map(([t, s], i) => (
            <div key={t} className="rounded-lg border border-ink-200 p-3">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-[10px] font-bold text-white">{i + 1}</span>
                <p className="text-xs font-semibold text-ink-900">{t}</p>
              </div>
              <p className="text-[11px] leading-relaxed text-ink-600">{s}</p>
            </div>
          ))}
        </div>
      </Card>

      <Modal
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={open?.name ?? ""}
        subtitle={open ? `${open.vendor} · ${open.kind.toUpperCase()} · ${open.direction}` : ""}
        footer={
          open && (
            <>
              <Button onClick={() => setOpen(null)}>Close</Button>
              <Button icon={<RefreshCw size={14} />} onClick={() => { audit("integration.sync", `${open.name} manual sync`); notify("Sync triggered"); }}>
                Sync now
              </Button>
              {open.status === "error" && (
                <Button variant="primary" onClick={() => { audit("integration.retry", open.name, "warning"); notify("Queued events are being reconciled"); setOpen(null); }}>
                  Reconcile queued events
                </Button>
              )}
            </>
          )
        }
      >
        {open && (
          <div className="space-y-2 text-sm">
            {[
              ["Endpoint", open.endpoint],
              ["Status", open.status],
              ["Direction", open.direction],
              ["Last sync", open.lastSync ? relative(open.lastSync) : "never"],
              ["Records synced", open.recordsSynced.toLocaleString("en-IN")],
              ["Auth", "OAuth 2.0 client credentials, secrets in KMS"],
              ["Transport", open.kind === "hl7" ? "MLLP over private link" : "TLS 1.3 over private link"],
            ].map(([k, v]) => (
              <p key={k} className="flex justify-between gap-3 border-b border-ink-100 pb-1.5 text-xs">
                <span className="text-ink-500">{k}</span>
                <span className="break-all text-right font-medium text-ink-800">{v}</span>
              </p>
            ))}
            {open.status === "live" && (
              <p className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900">
                <CheckCircle2 size={14} /> Healthy — last 100 requests succeeded with a p95 of 240 ms.
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
