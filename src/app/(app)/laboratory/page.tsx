"use client";

/**
 * Laboratory workbench.
 *
 * The board follows the real workflow rather than a flat list:
 *   Orders → Sample collection → Processing → Result entry → Verification → Released
 *
 * Each column only offers the action that step allows, and each action checks a
 * different permission on the server — entering a result and verifying it are
 * separable duties.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import {
  Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader,
  StatTile, Table, Td, Textarea, Th, Tr,
} from "@/components/ui";
import { api, readJson } from "@/lib/http";
import { cx, fmtDateTime, relative } from "@/lib/utils";
import {
  AlertTriangle, CheckCircle2, FlaskConical, Loader2, Send, ShieldCheck, Syringe, TestTube2,
} from "lucide-react";

interface Analyte {
  id: string; code: string; name: string; unit: string;
  refLow: number | null; refHigh: number | null; criticalLow: number | null; criticalHigh: number | null; refText: string;
}
interface TestDef { id: string; code: string; name: string; category: string; specimen: string; analytes: Analyte[] }
interface Result {
  id: string; analyteCode: string; analyteName: string; value: string; unit: string;
  refLow: number | null; refHigh: number | null; refText: string; flag: string; status: string; version: number;
  computed?: boolean; deltaNote?: string;
  enteredBy: string; verifiedBy: string;
}
interface Order {
  id: string; patientId: string; patientName?: string; uhid?: string;
  orderNo: string; status: string; priority: string; clinicalNote: string;
  orderedBy: string; orderedAt: string; sampleId: string | null;
  collectedBy: string | null; collectedAt: string | null;
  enteredBy: string | null; verifiedBy: string | null; critical: boolean;
  tests: { id: string; testId: string | null; code: string; name: string }[];
  results: Result[];
}
interface CriticalNotification {
  id: string; patientId: string; patientName: string; uhid: string; orderNo: string;
  analyteName: string; value: string; flag: string; status: string;
  detectedAt: string; notifiedAt: string | null; notifiedTo: string;
  acknowledgedAt: string | null; acknowledgedBy: string; note: string;
}

const FLAG_TONE: Record<string, "green" | "amber" | "red" | "neutral"> = {
  NORMAL: "green", LOW: "amber", HIGH: "amber", ABNORMAL: "amber",
  CRITICAL_LOW: "red", CRITICAL_HIGH: "red",
};

const COLUMNS: { key: string; label: string; icon: React.ReactNode }[] = [
  { key: "ORDERED", label: "Ordered", icon: <FlaskConical size={14} /> },
  { key: "SAMPLE_COLLECTED", label: "Sample collected", icon: <Syringe size={14} /> },
  { key: "PROCESSING", label: "Processing", icon: <TestTube2 size={14} /> },
  { key: "RESULT_ENTERED", label: "Awaiting verification", icon: <ShieldCheck size={14} /> },
  { key: "VERIFIED", label: "Verified", icon: <CheckCircle2 size={14} /> },
  { key: "RELEASED", label: "Released", icon: <Send size={14} /> },
];

export default function LaboratoryPage() {
  const { can, notify } = useStore();

  const [orders, setOrders] = useState<Order[]>([]);
  const [catalog, setCatalog] = useState<TestDef[]>([]);
  const [criticals, setCriticals] = useState<CriticalNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Order | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [amendReason, setAmendReason] = useState("");
  const [ackFor, setAckFor] = useState<CriticalNotification | null>(null);
  const [ackNote, setAckNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, c, n] = await Promise.all([
        fetch("/api/lab/orders").then(readJson) as Promise<{ items: Order[] }>,
        fetch("/api/lab/catalog").then(readJson) as Promise<{ items: TestDef[] }>,
        fetch("/api/lab/critical").then(readJson) as Promise<{ items: CriticalNotification[] }>,
      ]);
      setOrders(o.items ?? []);
      setCatalog(c.items ?? []);
      setCriticals(n.items ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byStatus = useMemo(() => {
    const m: Record<string, Order[]> = {};
    for (const c of COLUMNS) m[c.key] = [];
    for (const o of orders) (m[o.status] ??= []).push(o);
    return m;
  }, [orders]);

  const openAnalytes = useMemo(() => {
    if (!open) return [];
    const codes = new Set(open.tests.map((t) => t.code));
    return catalog.filter((t) => codes.has(t.code)).flatMap((t) => t.analytes);
  }, [open, catalog]);

  if (!can("labs.manage")) return <Denied />;

  async function act(orderId: string, payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await api<{ order: Order }>(`/api/lab/orders/${orderId}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      notify("Updated");
      setOpen(res.order ?? null);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not complete that step");
    } finally {
      setBusy(false);
    }
  }

  const pendingCriticals = criticals.filter((c) => c.status !== "ACKNOWLEDGED");

  return (
    <>
      <PageHeader
        title="Laboratory"
        subtitle="Order → sample → processing → result → verification → release. A verified result can only be amended, with a reason."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Open orders" value={orders.filter((o) => !["RELEASED", "CANCELLED"].includes(o.status)).length} icon={<FlaskConical size={16} />} />
        <StatTile label="Awaiting collection" value={byStatus.ORDERED?.length ?? 0} tone="amber" />
        <StatTile label="Awaiting verification" value={byStatus.RESULT_ENTERED?.length ?? 0} tone="amber" />
        <StatTile label="Critical results" value={criticals.length} tone={pendingCriticals.length ? "red" : "neutral"} />
        <StatTile label="Unacknowledged" value={pendingCriticals.length} tone={pendingCriticals.length ? "red" : "green"} />
      </div>

      {pendingCriticals.length > 0 && (
        <Card className="mb-5 border-rose-300 bg-rose-50/50">
          <CardHeader
            title="Critical results awaiting a clinician"
            subtitle="Routed to a named person. No automated system interprets or acts on these."
            icon={<AlertTriangle size={16} className="text-rose-700" />}
          />
          <Table>
            <thead><Tr><Th>Detected</Th><Th>Patient</Th><Th>Analyte</Th><Th>Value</Th><Th>Order</Th><Th>State</Th><Th /></Tr></thead>
            <tbody>
              {pendingCriticals.map((c) => (
                <Tr key={c.id}>
                  <Td>{relative(c.detectedAt)}</Td>
                  <Td>
                    <Link href={`/patients/${c.patientId}`} className="font-medium text-brand-700 hover:underline">{c.patientName}</Link>
                    <span className="ml-2 text-xs text-ink-400">{c.uhid}</span>
                  </Td>
                  <Td>{c.analyteName}</Td>
                  <Td><b className="text-rose-700">{c.value}</b></Td>
                  <Td>{c.orderNo}</Td>
                  <Td><Badge tone={c.status === "PENDING" ? "red" : "amber"}>{c.status}</Badge></Td>
                  <Td>
                    <div className="flex gap-1">
                      {c.status === "PENDING" && can("labs.result") && (
                        <Button
                          size="sm"
                          onClick={() => {
                            const to = window.prompt("Who was informed? (name and role)");
                            if (to) void api(`/api/lab/critical/${c.id}`, {
                              method: "POST", headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "notify", to, channel: "phone" }),
                            }).then(load);
                          }}
                        >
                          Mark notified
                        </Button>
                      )}
                      {can("escalations.resolve") && (
                        <Button size="sm" variant="primary" onClick={() => { setAckFor(c); setAckNote(""); }}>
                          Acknowledge
                        </Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-ink-500"><Loader2 size={16} className="animate-spin" /> Loading…</div>
      ) : orders.length === 0 ? (
        <EmptyState title="No laboratory orders yet" hint="Order a test from a patient's profile." icon={<FlaskConical size={22} />} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {COLUMNS.map((col) => (
            <Card key={col.key} padded={false} className="flex min-h-[160px] flex-col">
              <div className="flex items-center gap-2 border-b border-ink-200 px-3 py-2">
                <span className="text-ink-500">{col.icon}</span>
                <span className="text-xs font-semibold text-ink-800">{col.label}</span>
                <span className="ml-auto rounded-full bg-ink-100 px-1.5 text-[10px] font-semibold text-ink-600">
                  {byStatus[col.key]?.length ?? 0}
                </span>
              </div>
              <div className="flex-1 space-y-2 p-2">
                {(byStatus[col.key] ?? []).map((o) => (
                  <button
                    key={o.id}
                    onClick={() => { setOpen(o); setValues({}); setAmendReason(""); }}
                    className={cx(
                      "w-full rounded-lg border px-2 py-2 text-left transition hover:shadow-sm",
                      o.critical ? "border-rose-300 bg-rose-50" : "border-ink-200 bg-white",
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-xs font-semibold text-ink-900">{o.orderNo}</span>
                      {o.priority !== "routine" && <Badge tone={o.priority === "stat" ? "red" : "amber"}>{o.priority}</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-700">{o.patientName}</p>
                    <p className="truncate text-[10px] text-ink-500">{o.tests.map((t) => t.name).join(", ")}</p>
                    <p className="mt-0.5 text-[10px] text-ink-400">{relative(o.orderedAt)}</p>
                  </button>
                ))}
                {(byStatus[col.key] ?? []).length === 0 && (
                  <p className="px-1 py-4 text-center text-[11px] text-ink-400">Nothing here</p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ------------------------------ order drawer ------------------------ */}
      <Modal
        open={Boolean(open)} onClose={() => setOpen(null)} wide
        title={open ? `${open.orderNo} — ${open.tests.map((t) => t.name).join(", ")}` : ""}
        subtitle={open ? `${open.patientName} · ${open.uhid} · ordered ${fmtDateTime(open.orderedAt)} by ${open.orderedBy}` : ""}
        footer={
          open ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <Badge tone={open.status === "RELEASED" || open.status === "VERIFIED" ? "green" : "amber"}>{open.status}</Badge>
              <div className="flex flex-wrap gap-2">
                {open.status === "ORDERED" && can("labs.collect") && (
                  <Button variant="primary" disabled={busy} onClick={() => act(open.id, { action: "collect" })} icon={<Syringe size={15} />}>
                    Collect sample
                  </Button>
                )}
                {open.status === "SAMPLE_COLLECTED" && can("labs.result") && (
                  <Button variant="primary" disabled={busy} onClick={() => act(open.id, { action: "process" })} icon={<TestTube2 size={15} />}>
                    Start processing
                  </Button>
                )}
                {(open.status === "PROCESSING" || open.status === "RESULT_ENTERED") && can("labs.result") && (
                  <Button
                    variant="primary" disabled={busy || Object.values(values).every((v) => !v)}
                    onClick={() => act(open.id, {
                      action: "results",
                      entries: Object.entries(values).filter(([, v]) => v !== "").map(([analyteCode, value]) => ({ analyteCode, value })),
                    })}
                  >
                    Save results
                  </Button>
                )}
                {open.status === "RESULT_ENTERED" && can("labs.verify") && (
                  <Button variant="success" disabled={busy} onClick={() => act(open.id, { action: "verify" })} icon={<ShieldCheck size={15} />}>
                    Verify
                  </Button>
                )}
                {open.status === "VERIFIED" && can("labs.verify") && (
                  <Button variant="primary" disabled={busy} onClick={() => act(open.id, { action: "release" })} icon={<Send size={15} />}>
                    Release to the ward
                  </Button>
                )}
                {(open.status === "VERIFIED" || open.status === "RELEASED") && can("labs.result") && (
                  <Button
                    disabled={busy || !amendReason || Object.values(values).every((v) => !v)}
                    onClick={() => act(open.id, {
                      action: "results", amendReason,
                      entries: Object.entries(values).filter(([, v]) => v !== "").map(([analyteCode, value]) => ({ analyteCode, value })),
                    })}
                  >
                    Amend
                  </Button>
                )}
              </div>
            </div>
          ) : undefined
        }
      >
        {open && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              {[
                ["Sample id", open.sampleId ?? "—"],
                ["Collected", open.collectedAt ? `${fmtDateTime(open.collectedAt)} · ${open.collectedBy}` : "—"],
                ["Entered by", open.enteredBy ?? "—"],
                ["Verified by", open.verifiedBy ?? "—"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-ink-500">{k}</dt>
                  <dd className="font-medium text-ink-900">{v}</dd>
                </div>
              ))}
            </dl>
            {open.clinicalNote && (
              <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
                <b>Clinical note:</b> {open.clinicalNote}
              </p>
            )}

            {(open.status === "PROCESSING" || open.status === "RESULT_ENTERED" || open.status === "VERIFIED" || open.status === "RELEASED")
              && can("labs.result") && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  {open.status === "VERIFIED" || open.status === "RELEASED" ? "Amend a value" : "Enter results"}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {openAnalytes.map((a) => {
                    const existing = open.results.find((r) => r.analyteCode === a.code);
                    return (
                      <Field
                        key={a.code}
                        label={`${a.name}${a.unit ? ` (${a.unit})` : ""}`}
                        hint={
                          a.refText ? `Reference: ${a.refText}`
                            : a.refLow !== null && a.refHigh !== null ? `Reference ${a.refLow} – ${a.refHigh}` : undefined
                        }
                      >
                        <Input
                          placeholder={existing ? `current: ${existing.value}` : ""}
                          value={values[a.code] ?? ""}
                          onChange={(e) => setValues({ ...values, [a.code]: e.target.value })}
                        />
                      </Field>
                    );
                  })}
                </div>
                {(open.status === "VERIFIED" || open.status === "RELEASED") && (
                  <Field
                    label="Reason for amendment"
                    hint="A verified result cannot be changed silently — the previous value is kept as a version"
                    className="mt-3"
                  >
                    <Textarea rows={2} value={amendReason} onChange={(e) => setAmendReason(e.target.value)} />
                  </Field>
                )}
              </div>
            )}

            {open.results.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Recorded results</p>
                <Table>
                  <thead><Tr><Th>Analyte</Th><Th>Value</Th><Th>Unit</Th><Th>Reference</Th><Th>Flag</Th><Th>Status</Th><Th>By</Th></Tr></thead>
                  <tbody>
                    {open.results.map((r) => (
                      <Tr key={r.id}>
                        <Td>
                          {r.analyteName}
                          {/* Calculated values are marked, so nobody mistakes one
                              for something a person measured and checked. */}
                          {r.computed && <Badge tone="blue" className="ml-1.5">calculated</Badge>}
                          {/* The delta warning belongs next to the number it
                              concerns — a technician will not go looking for it. */}
                          {r.deltaNote && (
                            <span className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-amber-700">
                              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                              {r.deltaNote}
                            </span>
                          )}
                        </Td>
                        <Td>{r.value ? <b>{r.value}</b> : <span className="text-ink-400">not reported</span>}</Td>
                        <Td>{r.unit}</Td>
                        <Td className="max-w-[220px] text-xs">
                          {r.computed && !r.value
                            ? <span className="text-ink-500">{r.refText}</span>
                            : r.refText || (r.refLow !== null && r.refHigh !== null ? `${r.refLow} – ${r.refHigh}` : "—")}
                        </Td>
                        <Td><Badge tone={FLAG_TONE[r.flag] ?? "neutral"}>{r.flag.replace("_", " ")}</Badge></Td>
                        <Td>{r.status}{r.version > 1 ? ` (v${r.version})` : ""}</Td>
                        <Td className="text-xs">{r.verifiedBy || r.enteredBy}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(ackFor)} onClose={() => setAckFor(null)} title="Acknowledge a critical result"
        subtitle={ackFor ? `${ackFor.analyteName} ${ackFor.value} — ${ackFor.patientName}` : ""}
        footer={
          <>
            <Button onClick={() => setAckFor(null)}>Cancel</Button>
            <Button
              variant="primary" disabled={busy}
              onClick={async () => {
                if (!ackFor) return;
                setBusy(true);
                try {
                  await api(`/api/lab/critical/${ackFor.id}`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "acknowledge", note: ackNote }),
                  });
                  setAckFor(null);
                  notify("Acknowledged");
                  await load();
                } catch (e) {
                  notify(e instanceof Error ? e.message : "Could not acknowledge");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Acknowledge
            </Button>
          </>
        }
      >
        <Field label="Clinical action taken" hint="Recorded with your name and the time">
          <Textarea rows={3} value={ackNote} onChange={(e) => setAckNote(e.target.value)} />
        </Field>
      </Modal>
    </>
  );
}
