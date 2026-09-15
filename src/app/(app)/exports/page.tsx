"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Denied, FeatureGate } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Modal, PageHeader, Select, StatTile, Table, Td, Th, Toggle, Tr } from "@/components/ui";
import { cx, fmtDateTime, relative } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Clock, Download, FileSpreadsheet, Loader2, Lock, ShieldCheck } from "lucide-react";

interface Job {
  id: string;
  requestedBy: string;
  template: string;
  scope: { maskPhone?: boolean; includeClinical?: boolean; days?: number | null };
  status: string;
  rows: number;
  bytes: number;
  downloadToken: string | null;
  expiresAt: string | null;
  downloadedAt: string | null;
  createdAt: string;
}

interface Template { id: string; label: string; sensitive: boolean }

export default function ExportsPage() {
  return (
    <FeatureGate feature="data_io">
      <ExportsInner />
    </FeatureGate>
  );
}

function ExportsInner() {
  const { can, createExport, notify } = useStore();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [open, setOpen] = useState<Template | null>(null);
  const [maskPhone, setMaskPhone] = useState(true);
  const [includeClinical, setIncludeClinical] = useState(false);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetch("/api/exports")
      .then((r) => r.json())
      .then((d) => {
        setTemplates(d.templates ?? []);
        setJobs(d.jobs ?? []);
      })
      .catch(() => {});

  useEffect(() => {
    load();
  }, []);

  if (!can("data.export")) return <Denied />;

  async function generate() {
    if (!open) return;
    setBusy(true);
    const res = await createExport(open.id, { maskPhone, includeClinical, days });
    setBusy(false);
    setOpen(null);
    if (res) {
      notify(`Export ready — ${res.rows} rows. The link is single-use and expires in an hour.`);
      await load();
      window.open(res.downloadUrl, "_blank");
    }
  }

  const expired = (j: Job) => Boolean(j.expiresAt && new Date(j.expiresAt).getTime() < Date.now());

  return (
    <>
      <PageHeader title="Export centre" subtitle="Governed data exports — scoped, column-filtered by your role, and audited end to end" />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Exports generated" value={jobs.length} icon={<FileSpreadsheet size={15} />} tone="brand" />
        <StatTile label="Rows exported" value={jobs.reduce((s, j) => s + j.rows, 0).toLocaleString("en-IN")} icon={<Download size={15} />} />
        <StatTile label="Downloaded" value={jobs.filter((j) => j.downloadedAt).length} sub={`${jobs.filter((j) => !j.downloadedAt && !expired(j)).length} awaiting download`} icon={<CheckCircle2 size={15} />} tone="green" />
        <StatTile label="Links expired" value={jobs.filter((j) => expired(j) && !j.downloadedAt).length} sub="never downloaded" icon={<Clock size={15} />} tone="amber" />
      </div>

      <Card className="mb-4">
        <CardHeader title="Generate an export" subtitle="Everything is written to your own storage first, then handed over on a single-use link" icon={<Download size={16} />} />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {templates.map((t) => (
            <div key={t.id} className="rounded-xl border border-ink-200 p-4">
              <div className="mb-1.5 flex items-center gap-2">
                <FileSpreadsheet size={15} className="text-ink-400" />
                <p className="text-sm font-semibold text-ink-900">{t.label}</p>
              </div>
              {t.sensitive && <Badge tone="amber">contains clinical fields</Badge>}
              <Button
                size="sm"
                className="mt-3 w-full"
                onClick={() => {
                  setOpen(t);
                  setMaskPhone(true);
                  setIncludeClinical(false);
                  setDays(30);
                }}
              >
                Generate
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader title="Export history" subtitle="Who exported what, with which scope, and whether they collected it" icon={<ShieldCheck size={16} />} />
        </div>
        {jobs.length === 0 ? (
          <div className="p-5"><EmptyState title="No exports yet" icon={<FileSpreadsheet size={22} />} /></div>
        ) : (
          <Table>
            <thead>
              <tr><Th>Template</Th><Th>Requested by</Th><Th>Scope</Th><Th>Rows</Th><Th>Created</Th><Th>Link</Th><Th /></tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <Tr key={j.id}>
                  <Td className="font-medium text-ink-900">{templates.find((t) => t.id === j.template)?.label ?? j.template}</Td>
                  <Td className="text-xs">{j.requestedBy}</Td>
                  <Td className="text-xs">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={j.scope.maskPhone ? "green" : "amber"}>{j.scope.maskPhone ? "phone masked" : "full phone"}</Badge>
                      <Badge tone={j.scope.includeClinical ? "amber" : "neutral"}>{j.scope.includeClinical ? "clinical included" : "clinical excluded"}</Badge>
                      {j.scope.days ? <Badge>{j.scope.days}d</Badge> : null}
                    </div>
                  </Td>
                  <Td className="tabular-nums">{j.rows.toLocaleString("en-IN")}</Td>
                  <Td className="text-xs text-ink-500">{relative(j.createdAt)}</Td>
                  <Td>
                    {j.downloadedAt ? (
                      <Badge tone="neutral">used {relative(j.downloadedAt)}</Badge>
                    ) : expired(j) ? (
                      <Badge tone="red">expired</Badge>
                    ) : (
                      <Badge tone="green">valid until {j.expiresAt ? fmtDateTime(j.expiresAt).split(", ")[1] : "—"}</Badge>
                    )}
                  </Td>
                  <Td>
                    {!expired(j) && j.downloadToken && (
                      <a href={`/api/exports/${j.id}/download?token=${j.downloadToken}`} target="_blank" rel="noreferrer">
                        <Button size="sm" icon={<Download size={13} />}>Download</Button>
                      </a>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="Why exports are a governed workflow, not a button" icon={<Lock size={16} />} />
        <div className="grid gap-3 text-xs leading-relaxed text-ink-600 md:grid-cols-4">
          {[
            ["Your role filters the columns", "The server decides what you may see. Asking for clinical free text without the permission returns [restricted], not an error you can work around."],
            ["Written to your own storage", "The file lands in the same bucket or volume as your recordings, under your retention rules."],
            ["Single-use, short-lived link", "Valid for one hour and marked used on first download, so an export URL in a chat thread is worthless afterwards."],
            ["Audited twice", "One critical event when the file is generated, another when it is collected — with the row count and scope on both."],
          ].map(([t, s]) => (
            <div key={t} className="rounded-lg border border-ink-200 p-3">
              <p className="mb-1 text-xs font-semibold text-ink-900">{t}</p>
              <p>{s}</p>
            </div>
          ))}
        </div>
      </Card>

      <Modal
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={`Generate ${open?.label ?? ""}`}
        subtitle="Scope and column filtering are applied on the server before the file is built"
        footer={
          <>
            <Button onClick={() => setOpen(null)}>Cancel</Button>
            <Button variant="primary" onClick={generate} disabled={busy} icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}>
              {busy ? "Generating…" : "Generate & download"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Date range">
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={3650}>Everything</option>
            </Select>
          </Field>
          <div className="divide-y divide-ink-100 rounded-lg border border-ink-200 px-3">
            <Toggle label="Mask phone numbers" description="Only the last four digits are included" checked={maskPhone} onChange={setMaskPhone} />
            <Toggle
              label="Include clinical free text"
              description={can("patients.clinical.view") ? "Summaries, diagnoses and resolution notes" : "Not available to your role — the server will exclude it regardless"}
              checked={includeClinical && can("patients.clinical.view")}
              onChange={(v) => (can("patients.clinical.view") ? setIncludeClinical(v) : notify("Your role cannot export clinical free text"))}
            />
          </div>
          <p className={cx("flex items-start gap-2 rounded-lg p-3 text-[11px] leading-relaxed", includeClinical ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : "bg-ink-50 text-ink-600")}>
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            This export will be attributed to you in the audit trail with its scope, filters and row count. The download
            link expires in one hour and works once.
          </p>
        </div>
      </Modal>
    </>
  );
}
