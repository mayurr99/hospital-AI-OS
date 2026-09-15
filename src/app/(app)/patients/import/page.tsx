"use client";

/**
 * Bulk patient import.
 *
 * Five real steps against the server: upload → map → preview → commit →
 * results. Nothing is written until the operator presses Import, and every
 * decision they make on this screen (which rows, which conflicts) is sent with
 * the commit.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import {
  Badge, Button, Card, CardHeader, EmptyState, Field, Modal, PageHeader, Select, Table, Td, Th, Tr,
} from "@/components/ui";
import { readJson } from "@/lib/http";
import { cx, fmtDateTime } from "@/lib/utils";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Download, FileSpreadsheet, FileUp, History,
  Loader2, ShieldCheck, Users, XCircle,
} from "lucide-react";

type Step = "upload" | "map" | "preview" | "done";

interface Issue { field: string; message: string }
interface Conflict { field: string; existing: unknown; incoming: unknown }
interface Match { patientId: string; uhid: string; name: string; mobile: string; strength: string; reason: string }
interface Row {
  id?: string;
  rowNo: number;
  sheet: "PATIENTS" | "ADMISSIONS";
  raw: Record<string, unknown>;
  normalized: Record<string, unknown>;
  status: string;
  action: string;
  errors: Issue[];
  warnings: Issue[];
  conflicts: Conflict[];
  matches: Match[];
  matchPatientId: string | null;
  matchStrength: string;
}
interface ColumnDef { key: string; label: string; sheet: string; hint?: string }

export default function ImportPatientsPage() {
  const { can, notify } = useStore();

  const [step, setStep] = useState<Step>("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [history, setHistory] = useState<Record<string, unknown>[]>([]);

  const [file, setFile] = useState<File | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, Record<string, string>>>({ PATIENTS: {}, ADMISSIONS: {} });
  const [detected, setDetected] = useState<Record<string, { headers: string[]; unmapped: string[] }>>({});
  const [patientRows, setPatientRows] = useState<Row[]>([]);
  const [admissionRows, setAdmissionRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [actions, setActions] = useState<Record<string, string>>({});
  const [conflictPolicy, setConflictPolicy] = useState<"keep_existing" | "use_excel" | "review">("keep_existing");
  const [result, setResult] = useState<Record<string, number | string> | null>(null);
  const [detailRow, setDetailRow] = useState<Row | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const loadMeta = useCallback(async () => {
    const res = await fetch("/api/import");
    if (!res.ok) return;
    const data = await readJson<{ columns: ColumnDef[]; batches: Record<string, unknown>[] }>(res);
    setColumns(data.columns ?? []);
    setHistory(data.batches ?? []);
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  async function upload(f: File, overrideMapping?: Record<string, Record<string, string>>) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      if (overrideMapping) fd.append("mapping", JSON.stringify(overrideMapping));
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const data = await readJson<Record<string, unknown>>(res);
      if (!res.ok) throw new Error((data.error as string) ?? "Upload failed");

      setBatchId(data.batchId as string);
      setMapping(data.mapping as Record<string, Record<string, string>>);
      setDetected(data.detected as Record<string, { headers: string[]; unmapped: string[] }>);
      const pr = ((data.patientRows as Row[]) ?? []).map((r, i) => ({ ...r, id: `p${i}` }));
      setPatientRows(pr);
      setAdmissionRows((data.admissionRows as Row[]) ?? []);
      setSummary(data.summary as Record<string, number>);
      setActions({});
      const unmapped = Object.values(data.detected as Record<string, { unmapped: string[] }>)
        .flatMap((d) => d.unmapped ?? []);
      setStep(unmapped.length ? "map" : "preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!batchId) return;
    setBusy(true);
    setError(null);
    try {
      // Row actions are keyed by the server's row id, which we fetch fresh so
      // the operator's per-row choices survive a re-preview.
      const detail = await fetch(`/api/import/${batchId}`).then(readJson) as { rows: Row[] };
      const byRowNo = new Map(detail.rows.filter((r) => r.sheet === "PATIENTS").map((r) => [r.rowNo, r.id!]));
      const serverActions: Record<string, string> = {};
      for (const r of patientRows) {
        const chosen = actions[r.id!] ?? r.action;
        const serverId = byRowNo.get(r.rowNo);
        if (serverId) serverActions[serverId] = chosen;
      }

      const res = await fetch(`/api/import/${batchId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actions: serverActions, conflictPolicy, importAdmissions: true }),
      });
      const data = await readJson<Record<string, number | string>>(res);
      if (!res.ok) throw new Error((data.error as string) ?? "Import failed");
      setResult(data);
      setStep("done");
      notify(`Import complete — ${data.created} created, ${data.updated} updated`);
      void loadMeta();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const c = { create: 0, update: 0, use_existing: 0, skip: 0, invalid: 0 };
    for (const r of patientRows) {
      if (r.errors.length) c.invalid += 1;
      else c[(actions[r.id!] ?? r.action) as keyof typeof c] += 1;
    }
    return c;
  }, [patientRows, actions]);

  if (!can("data.import")) return <Denied />;

  return (
    <>
      <PageHeader
        title="Import patients"
        subtitle="Upload your existing spreadsheet — your own column headings are fine"
        actions={
          <>
            <Link href="/patients">
              <Button icon={<ArrowLeft size={15} />}>Back to patients</Button>
            </Link>
            <Button
              variant="secondary"
              icon={<Download size={15} />}
              onClick={() => window.location.assign("/api/import/template")}
            >
              Download template
            </Button>
          </>
        }
      />

      <ol className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        {(["upload", "map", "preview", "done"] as Step[]).map((s, i) => {
          const order = ["upload", "map", "preview", "done"];
          const done = order.indexOf(step) > i;
          const active = step === s;
          return (
            <li key={s} className="flex items-center gap-2">
              <span
                className={cx(
                  "grid h-6 w-6 place-items-center rounded-full text-xs font-semibold",
                  active ? "bg-brand-600 text-white" : done ? "bg-emerald-100 text-emerald-700" : "bg-ink-100 text-ink-500",
                )}
              >
                {done ? <CheckCircle2 size={13} /> : i + 1}
              </span>
              <span className={cx("capitalize", active ? "font-medium text-ink-900" : "text-ink-500")}>
                {s === "map" ? "Column mapping" : s === "done" ? "Results" : s}
              </span>
              {i < 3 && <span className="text-ink-300">›</span>}
            </li>
          );
        })}
      </ol>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* ------------------------------ upload ----------------------------- */}
      {step === "upload" && (
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader
              title="Upload Excel or CSV"
              subtitle="Two sheets are read: PATIENTS and ADMISSIONS. A single-sheet CSV is treated as PATIENTS."
              icon={<FileUp size={16} />}
            />
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) {
                  setFile(f);
                  void upload(f);
                }
              }}
              className="rounded-xl border-2 border-dashed border-ink-300 bg-ink-50/60 px-6 py-12 text-center"
            >
              <FileSpreadsheet size={28} className="mx-auto text-ink-400" />
              <p className="mt-3 text-sm font-medium text-ink-800">Drop your file here, or choose one</p>
              <p className="mt-1 text-xs text-ink-500">.xlsx or .csv, up to 12 MB</p>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setFile(f);
                    void upload(f);
                  }
                }}
              />
              <Button
                variant="primary"
                className="mt-4"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                icon={busy ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
              >
                {busy ? "Reading and validating…" : "Choose a file"}
              </Button>
              {file && !busy && <p className="mt-3 text-xs text-ink-500">{file.name}</p>}
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-xs text-ink-700">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-brand-700" />
              <span>
                Nothing is written to your patient records at this stage. The file is read, validated and matched
                against your existing patients, and you review the result before anything is created.
              </span>
            </div>
          </Card>

          <Card>
            <CardHeader title="Recent imports" subtitle="Every batch is audited" icon={<History size={16} />} />
            {history.length === 0 ? (
              <EmptyState title="No imports yet" hint="Your first upload will appear here." />
            ) : (
              <div className="space-y-2">
                {history.slice(0, 8).map((b) => (
                  <div key={b.id as string} className="rounded-lg border border-ink-200 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink-800">{b.filename as string}</span>
                      <Badge tone={b.status === "COMMITTED" ? "green" : b.status === "PARTIAL" ? "amber" : "neutral"}>
                        {b.status as string}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink-500">
                      {fmtDateTime(b.uploadedAt as string)} · {b.uploadedBy as string} ·{" "}
                      {(b.createdCount as number) ?? 0} created, {(b.updatedCount as number) ?? 0} updated,{" "}
                      {(b.failedCount as number) ?? 0} failed
                    </p>
                    <a href={`/api/import/${b.id}/errors`} className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline">
                      Download error report
                    </a>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ------------------------------ mapping ---------------------------- */}
      {step === "map" && (
        <Card>
          <CardHeader
            title="Column mapping"
            subtitle="We matched what we recognised. Correct anything below — the mapping is remembered for your hospital's next import."
            icon={<FileSpreadsheet size={16} />}
          />
          {(["PATIENTS", "ADMISSIONS"] as const).map((sheet) =>
            detected[sheet] ? (
              <div key={sheet} className="mb-6">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{sheet} sheet</h4>
                <div className="grid gap-2 sm:grid-cols-2">
                  {detected[sheet].headers.map((h) => (
                    <div key={h} className="flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-2">
                      <span className="w-1/2 truncate text-sm text-ink-700" title={h}>{h}</span>
                      <ArrowRight size={13} className="shrink-0 text-ink-400" />
                      <select
                        className="w-1/2 rounded-lg border border-ink-200 bg-white px-2 py-1 text-sm"
                        value={mapping[sheet]?.[h] ?? "__ignore"}
                        onChange={(e) =>
                          setMapping((m) => ({ ...m, [sheet]: { ...m[sheet], [h]: e.target.value } }))
                        }
                      >
                        <option value="__ignore">— ignore this column —</option>
                        {columns
                          .filter((c) => c.sheet === sheet)
                          .map((c) => (
                            <option key={`${c.sheet}-${c.key}-${c.label}`} value={c.key}>{c.label}</option>
                          ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            ) : null,
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setStep("upload")}>Start over</Button>
            <Button
              variant="primary"
              disabled={busy || !file}
              onClick={() => file && upload(file, mapping)}
              icon={busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
            >
              Re-validate with this mapping
            </Button>
          </div>
        </Card>
      )}

      {/* ------------------------------ preview ---------------------------- */}
      {step === "preview" && summary && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Total rows", summary.totalRows, "neutral"],
              ["Valid", summary.validRows, "green"],
              ["Invalid", summary.invalidRows, "red"],
              ["Possible duplicates", summary.duplicateRows, "amber"],
              ["With warnings", summary.warningRows, "amber"],
              ["Admissions", summary.admissionsTotal, "brand"],
            ].map(([label, value]) => (
              <Card key={String(label)} padded={false} className="px-4 py-3">
                <p className="text-xs text-ink-500">{label as string}</p>
                <p className="mt-1 text-xl font-semibold text-ink-900">{value as number}</p>
              </Card>
            ))}
          </div>

          <Card className="mb-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="text-sm text-ink-700">
                On import: <b>{counts.create}</b> created · <b>{counts.update}</b> updated ·{" "}
                <b>{counts.use_existing}</b> kept unchanged · <b>{counts.skip}</b> skipped ·{" "}
                <b className="text-rose-700">{counts.invalid}</b> rejected
              </div>
              <Field label="When a value differs from the existing record">
                <Select value={conflictPolicy} onChange={(e) => setConflictPolicy(e.target.value as typeof conflictPolicy)}>
                  <option value="keep_existing">Keep the existing value</option>
                  <option value="use_excel">Use the value from the spreadsheet</option>
                  <option value="review">Leave for review (keeps existing)</option>
                </Select>
              </Field>
            </div>
          </Card>

          <Card padded={false}>
            <Table>
              <thead>
                <Tr>
                  <Th>Row</Th>
                  <Th>Patient</Th>
                  <Th>DOB / age</Th>
                  <Th>Mobile</Th>
                  <Th>Status</Th>
                  <Th>Action on import</Th>
                  <Th>Problems</Th>
                </Tr>
              </thead>
              <tbody>
                {patientRows.map((r) => {
                  const n = r.normalized as Record<string, string>;
                  const bad = r.errors.length > 0;
                  return (
                    <Tr key={r.id} onClick={() => setDetailRow(r)}>
                      <Td>{r.rowNo}</Td>
                      <Td>
                        <span className="font-medium text-ink-900">
                          {[n.firstName, n.middleName, n.lastName].filter(Boolean).join(" ") || "—"}
                        </span>
                        {n.externalId && <span className="ml-2 text-xs text-ink-400">{n.externalId}</span>}
                      </Td>
                      <Td>{n.dateOfBirth ?? "—"}</Td>
                      <Td>{n.mobile || "—"}</Td>
                      <Td>
                        <Badge tone={bad ? "red" : r.status === "DUPLICATE" ? "amber" : "green"}>
                          {bad ? "INVALID" : r.status}
                        </Badge>
                      </Td>
                      <Td>
                        {bad ? (
                          <span className="text-xs text-rose-700">rejected</span>
                        ) : (
                          <select
                            className="rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs"
                            value={actions[r.id!] ?? r.action}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setActions((a) => ({ ...a, [r.id!]: e.target.value }))}
                          >
                            <option value="create">Create new</option>
                            {r.matchPatientId && <option value="use_existing">Use existing</option>}
                            {r.matchPatientId && <option value="update">Update existing</option>}
                            <option value="skip">Skip</option>
                          </select>
                        )}
                      </Td>
                      <Td>
                        {r.errors.length > 0 && (
                          <span className="mr-2 inline-flex items-center gap-1 text-xs text-rose-700">
                            <XCircle size={12} /> {r.errors.length}
                          </span>
                        )}
                        {r.warnings.length > 0 && (
                          <span className="mr-2 inline-flex items-center gap-1 text-xs text-amber-700">
                            <AlertTriangle size={12} /> {r.warnings.length}
                          </span>
                        )}
                        {r.conflicts.length > 0 && (
                          <span className="text-xs text-ink-500">{r.conflicts.length} conflict(s)</span>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          {admissionRows.length > 0 && (
            <Card className="mt-4" padded={false}>
              <div className="border-b border-ink-200 px-5 py-3 text-sm font-semibold text-ink-900">
                Admissions sheet — {admissionRows.length} row(s)
              </div>
              <Table>
                <thead>
                  <Tr><Th>Row</Th><Th>Patient id</Th><Th>Date</Th><Th>Type</Th><Th>Ward / bed</Th><Th>Problems</Th></Tr>
                </thead>
                <tbody>
                  {admissionRows.map((r) => {
                    const n = r.normalized as Record<string, string>;
                    return (
                      <Tr key={`a${r.rowNo}`} onClick={() => setDetailRow(r)}>
                        <Td>{r.rowNo}</Td>
                        <Td>{n.externalId}</Td>
                        <Td>{n.admissionDate ?? "—"}</Td>
                        <Td>{n.admissionType}</Td>
                        <Td>{[n.ward, n.bed].filter(Boolean).join(" / ") || "—"}</Td>
                        <Td>
                          {r.errors.length > 0 && <Badge tone="red">{r.errors.length} error(s)</Badge>}
                          {r.warnings.length > 0 && <Badge tone="amber">{r.warnings.length} warning(s)</Badge>}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          )}

          <div className="mt-5 flex flex-wrap justify-between gap-2">
            <div className="flex gap-2">
              <Button onClick={() => setStep("upload")}>Start over</Button>
              <Button onClick={() => setStep("map")}>Adjust mapping</Button>
              {batchId && (
                <a href={`/api/import/${batchId}/errors`}>
                  <Button icon={<Download size={15} />}>Download error report</Button>
                </a>
              )}
            </div>
            <Button
              variant="primary"
              disabled={busy || counts.create + counts.update === 0}
              onClick={commit}
              icon={busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
            >
              {busy ? "Importing…" : `Import ${counts.create + counts.update} patient(s)`}
            </Button>
          </div>
        </>
      )}

      {/* ------------------------------ results ---------------------------- */}
      {step === "done" && result && (
        <Card>
          <CardHeader
            title="Import complete"
            subtitle={`Batch ${batchId} · status ${result.status}`}
            icon={<CheckCircle2 size={16} className="text-emerald-600" />}
          />
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Created", result.created, "green"],
              ["Updated", result.updated, "brand"],
              ["Skipped", result.skipped, "neutral"],
              ["Failed", result.failed, "red"],
              ["Admissions created", result.admissionsCreated, "green"],
              ["Admissions failed", result.admissionsFailed, "red"],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-ink-200 px-4 py-3">
                <p className="text-xs text-ink-500">{label as string}</p>
                <p className="mt-1 text-xl font-semibold text-ink-900">{(value as number) ?? 0}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/patients">
              <Button variant="primary" icon={<Users size={15} />}>Open the patient list</Button>
            </Link>
            {batchId && (
              <a href={`/api/import/${batchId}/errors`}>
                <Button icon={<Download size={15} />}>Download error report</Button>
              </a>
            )}
            <Button
              onClick={() => {
                setStep("upload");
                setResult(null);
                setFile(null);
                setPatientRows([]);
                setAdmissionRows([]);
              }}
            >
              Import another file
            </Button>
          </div>
        </Card>
      )}

      {/* ---------------------------- row detail --------------------------- */}
      <Modal
        open={Boolean(detailRow)}
        onClose={() => setDetailRow(null)}
        title={`Row ${detailRow?.rowNo} — ${detailRow?.sheet}`}
        subtitle="What the file contained, and what we made of it"
        wide
      >
        {detailRow && (
          <div className="space-y-4">
            {detailRow.errors.length > 0 && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Errors</p>
                <ul className="mt-1 space-y-1 text-sm text-rose-900">
                  {detailRow.errors.map((e, i) => (
                    <li key={i}><b>{e.field}</b> — {e.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {detailRow.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Warnings</p>
                <ul className="mt-1 space-y-1 text-sm text-amber-900">
                  {detailRow.warnings.map((w, i) => (
                    <li key={i}><b>{w.field}</b> — {w.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {detailRow.matches.length > 0 && (
              <div className="rounded-lg border border-ink-200 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Possible existing patients</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {detailRow.matches.map((m) => (
                    <li key={m.patientId} className="flex items-center gap-2">
                      <Badge tone={m.strength === "strong" ? "red" : m.strength === "probable" ? "amber" : "neutral"}>
                        {m.strength}
                      </Badge>
                      <Link href={`/patients/${m.patientId}`} className="font-medium text-brand-700 hover:underline">
                        {m.name}
                      </Link>
                      <span className="text-xs text-ink-500">{m.uhid} · {m.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {detailRow.conflicts.length > 0 && (
              <div className="rounded-lg border border-ink-200 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Conflicting values</p>
                <Table>
                  <thead><Tr><Th>Field</Th><Th>Existing</Th><Th>Spreadsheet</Th></Tr></thead>
                  <tbody>
                    {detailRow.conflicts.map((c, i) => (
                      <Tr key={i}>
                        <Td>{c.field}</Td>
                        <Td>{String(c.existing)}</Td>
                        <Td>{String(c.incoming)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Raw row from your file</p>
              <pre className="max-h-56 overflow-auto rounded-lg bg-ink-900 p-3 text-xs text-ink-100">
                {JSON.stringify(detailRow.raw, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
