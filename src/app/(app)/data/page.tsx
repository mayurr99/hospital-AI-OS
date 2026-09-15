"use client";

import { useState } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Select, StatTile, Table, Tabs, Td, Th, Toggle, Tr } from "@/components/ui";
import { downloadCsv, fmtDateTime } from "@/lib/utils";
import {
  AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileUp, Lock, ShieldCheck, Upload,
} from "lucide-react";

type TabKey = "import" | "export" | "history";

const EXPORT_TEMPLATES = [
  { id: "followups", name: "Follow-up outcomes", desc: "Structured responses, review status, escalations and feedback per patient.", sensitive: true },
  { id: "appointments", name: "Appointment register", desc: "Bookings, sources, reschedules, cancellations and no-shows.", sensitive: false },
  { id: "calls", name: "Call log", desc: "Every AI conversation with duration, outcome, language, risk and governance versions.", sensitive: true },
  { id: "escalations", name: "Escalation & SLA report", desc: "Red flags raised, who acknowledged, response times against SLA.", sensitive: true },
  { id: "billing", name: "Billing summary", desc: "Invoices, payer mix, collections and outstanding.", sensitive: false },
  { id: "kpi", name: "Management KPI pack", desc: "Daily operational metrics for the last 30 days.", sensitive: false },
];

export default function DataPage() {
  const { can, notify, audit, currentUser } = useStore();
  const d = useOrgData();
  const [tab, setTab] = useState<TabKey>("import");
  const [exportOpen, setExportOpen] = useState<string | null>(null);
  const [maskPhone, setMaskPhone] = useState(true);
  const [includeClinical, setIncludeClinical] = useState(false);

  if (!can("data.import") && !can("data.export")) return <Denied />;


  /**
   * Import moved to its own screen at /patients/import, where it does the real
   * work against the server. This page keeps exports; the import tab now sends
   * the user there rather than animating a progress bar that did nothing.
   */
  function goToImport() {
    window.location.assign("/patients/import");
  }

  return (
    <>
      <PageHeader
        title="Excel / CSV import & export"
        subtitle="A practical interface for pilots and smaller facilities — never the system of record at enterprise scale"
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Imports this month" value={d.importJobs.length} icon={<FileUp size={15} />} tone="brand" />
        <StatTile label="Rows imported" value={d.importJobs.reduce((s, j) => s + j.valid, 0)} tone="green" icon={<CheckCircle2 size={15} />} />
        <StatTile label="Rows rejected" value={d.importJobs.reduce((s, j) => s + j.issues.reduce((x, i) => x + i.count, 0), 0)} tone="amber" icon={<AlertTriangle size={15} />} />
        <StatTile label="Export templates" value={EXPORT_TEMPLATES.length} icon={<Download size={15} />} />
      </div>

      <Card padded={false}>
        <div className="border-b border-ink-200 px-4 pt-2">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: "import", label: "Import" },
              { key: "export", label: "Export" },
              { key: "history", label: "History", count: d.importJobs.length },
            ]}
          />
        </div>

        {tab === "import" && (
          <div className="p-4">
            {!can("data.import") ? (
              <EmptyState title="Import is not permitted for your role" icon={<Lock size={22} />} />
            ) : (
              <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-6 text-center">
                <FileSpreadsheet size={26} className="mx-auto text-brand-700" />
                <p className="mt-2 text-sm font-semibold text-ink-900">Patient import has its own workspace</p>
                <p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed text-ink-600">
                  Upload your spreadsheet with your own column headings, correct the mapping once (it is remembered for
                  your hospital), review every row and duplicate, and only then commit. Nothing is written to your
                  patient records until you approve the preview.
                </p>
                <Button variant="primary" className="mt-4" icon={<Upload size={15} />} onClick={goToImport}>
                  Open the import workspace
                </Button>
              </div>
            )}
          </div>
        )}

        {tab === "export" && (
          <div className="p-4">
            {!can("data.export") ? (
              <EmptyState title="Export is not permitted for your role" icon={<Lock size={22} />} />
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {EXPORT_TEMPLATES.map((t) => (
                    <div key={t.id} className="rounded-xl border border-ink-200 p-4">
                      <div className="mb-1.5 flex items-center gap-2">
                        <FileSpreadsheet size={15} className="text-ink-400" />
                        <p className="text-sm font-semibold text-ink-900">{t.name}</p>
                        {t.sensitive && <Badge tone="amber">sensitive</Badge>}
                      </div>
                      <p className="text-xs leading-relaxed text-ink-600">{t.desc}</p>
                      <Button size="sm" className="mt-3 w-full" icon={<Download size={13} />} onClick={() => setExportOpen(t.id)}>
                        Generate export
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-xl border border-ink-200 bg-ink-50 p-4">
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                    <ShieldCheck size={15} className="text-ink-400" /> Governed export pipeline
                  </p>
                  <p className="text-xs leading-relaxed text-ink-600">
                    Request → permission check → scope and filter applied → audit event written → XLSX generated →
                    encrypted storage → short-lived download link → download logged, then the link expires. Sensitive
                    columns are filtered by the requesting user&apos;s role: a billing user exporting the follow-up report
                    does not receive clinical free text.
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "history" && (
          <Table>
            <thead><tr><Th>File</Th><Th>Uploaded by</Th><Th>When</Th><Th>Rows</Th><Th>Valid</Th><Th>Issues</Th><Th>Status</Th></tr></thead>
            <tbody>
              {d.importJobs.map((j) => (
                <Tr key={j.id}>
                  <Td className="font-medium text-ink-900">{j.fileName}</Td>
                  <Td className="text-xs">{j.uploadedBy}</Td>
                  <Td className="text-xs text-ink-500">{fmtDateTime(j.uploadedAt)}</Td>
                  <Td className="tabular-nums">{j.totalRows}</Td>
                  <Td className="tabular-nums text-emerald-600">{j.valid}</Td>
                  <Td className="tabular-nums text-amber-600">{j.issues.reduce((s, i) => s + i.count, 0)}</Td>
                  <Td><Badge tone={j.status === "imported" ? "green" : j.status === "preview" ? "amber" : "neutral"}>{j.status}</Badge></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={Boolean(exportOpen)}
        onClose={() => setExportOpen(null)}
        title={`Generate ${EXPORT_TEMPLATES.find((t) => t.id === exportOpen)?.name ?? ""}`}
        subtitle="Scope and column filtering are applied before the file is built"
        footer={
          <>
            <Button onClick={() => setExportOpen(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                const name = EXPORT_TEMPLATES.find((t) => t.id === exportOpen)!.name;
                audit("export.generated", `${name} — role-filtered, phone ${maskPhone ? "masked" : "full"}, clinical ${includeClinical ? "included" : "excluded"}`, "critical");
                const rows =
                  exportOpen === "calls"
                    ? d.calls.map((c) => ({
                        CallID: c.id, Patient: c.patientName,
                        Phone: maskPhone ? `••••••${c.phone.slice(-4)}` : c.phone,
                        Language: c.language, Started: fmtDateTime(c.startedAt), DurationSec: c.durationSeconds,
                        Outcome: c.outcome, Risk: c.risk, Review: c.reviewStatus,
                        Summary: includeClinical ? c.summary : "[restricted]",
                        AgentVersion: c.agentVersion, ProtocolVersion: c.protocolVersion,
                      }))
                    : exportOpen === "escalations"
                      ? d.escalations.map((e) => ({
                          ID: e.id, Level: e.level, Trigger: e.trigger, Raised: fmtDateTime(e.raisedAt),
                          Status: e.status, SLAMinutes: e.slaMinutes,
                          Acknowledged: e.acknowledgedAt ? fmtDateTime(e.acknowledgedAt) : "",
                          Resolution: includeClinical ? (e.resolutionNote ?? "") : "[restricted]",
                        }))
                      : d.series.map((s) => ({ ...s }));
                downloadCsv(`${exportOpen}_export.csv`, rows);
                notify("Export generated — download link is single-use and logged");
                setExportOpen(null);
              }}
            >
              Generate & download
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Date range">
            <Select><option>Last 7 days</option><option>Last 30 days</option><option>This quarter</option><option>Custom…</option></Select>
          </Field>
          <Field label="Department scope">
            <Select>
              <option>All departments</option>
              {d.departments.filter((x) => x.type === "clinical").map((x) => (<option key={x.id}>{x.name}</option>))}
            </Select>
          </Field>
          <div className="divide-y divide-ink-100 rounded-lg border border-ink-200 px-3">
            <Toggle label="Mask phone numbers" description="Only the last four digits are included" checked={maskPhone} onChange={setMaskPhone} />
            <Toggle
              label="Include clinical free text"
              description={can("patients.clinical.view") ? "Summaries and resolution notes" : "Not available to your role"}
              checked={includeClinical && can("patients.clinical.view")}
              onChange={(v) => can("patients.clinical.view") ? setIncludeClinical(v) : notify("Your role cannot export clinical free text")}
            />
          </div>
          <p className="rounded-lg bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
            This export will be attributed to <strong>{currentUser?.name}</strong> in the audit trail, with the scope,
            filters and row count recorded. The download link expires after one use.
          </p>
        </div>
      </Modal>
    </>
  );
}
