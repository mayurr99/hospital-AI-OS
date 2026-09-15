"use client";

/**
 * Admissions, ward board, bed management and transfers.
 *
 * A bed's occupancy is a consequence of an admission's active ward assignment,
 * never a field somebody edits. Every action here is one atomic server call.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { useLiveReload } from "@/lib/live";
import { useSticky } from "@/lib/sticky";
import { Denied } from "@/components/AppShell";
import {
  Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select,
  StatTile, Table, Td, Textarea, Th, Tr,
} from "@/components/ui";
import { api, readJson } from "@/lib/http";
import { cx, fmtDateTime, relative } from "@/lib/utils";
import {
  AlertTriangle, BedDouble, Brush, Building2, CheckCircle2, FlaskConical, Loader2, LogOut, Repeat, Wrench,
} from "lucide-react";

type TabKey = "board" | "current" | "beds" | "transfers";

interface Bed {
  id: string; wardId: string; wardName: string; number: string; status: string;
  roomName: string | null; dailyRate: number; note: string;
  occupant: null | {
    admissionId: string; admissionNo: string; patientId: string; patientName: string;
    uhid: string; admittedAt: string; since: string;
    /* What the laboratory still owes this patient — see listBeds. */
    pendingLabs?: number; unacknowledgedCriticals?: number;
  };
}
interface Admission {
  id: string; patientId: string; patientName?: string; uhid?: string;
  admissionNo: string; type: string; status: string; admittedAt: string; dischargedAt: string | null;
  reason: string; finalDiagnosis: string | null;
  currentWard: { wardId: string; wardName: string; bedId: string; bedNumber: string; since: string } | null;
}

const BED_TONE: Record<string, "green" | "amber" | "red" | "brand" | "neutral"> = {
  AVAILABLE: "green", OCCUPIED: "brand", RESERVED: "amber",
  CLEANING: "amber", MAINTENANCE: "neutral", BLOCKED: "red",
};

export default function AdmissionsPage() {
  const { can, notify } = useStore();
  const d = useOrgData();

  const [tab, setTab] = useSticky<TabKey>("admissions.tab", "board");
  const [beds, setBeds] = useState<Bed[]>([]);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [discharged, setDischarged] = useState<Admission[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<null | "admit" | "transfer" | "discharge" | "bed">(null);
  const [target, setTarget] = useState<Admission | Bed | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [wardFilter, setWardFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, a, dsc] = await Promise.all([
        fetch("/api/beds").then(readJson) as Promise<{ items: Bed[] }>,
        fetch("/api/admissions?status=ACTIVE").then(readJson) as Promise<{ items: Admission[] }>,
        fetch("/api/admissions?status=DISCHARGED").then(readJson) as Promise<{ items: Admission[] }>,
      ]);
      setBeds(b.items ?? []);
      setAdmissions(a.items ?? []);
      setDischarged(dsc.items ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * The board redraws itself.
   *
   * This is the screen two people are most likely to be looking at at the same
   * moment, and the one where a stale view does real harm: a bed shown free
   * after a colleague has just filled it sends a patient to an occupied room.
   */
  useLiveReload(["bed", "admission", "lab", "critical"], load);

  const wards = useMemo(() => {
    const m = new Map<string, { id: string; name: string; total: number; free: number; occupied: number }>();
    for (const b of beds) {
      const w = m.get(b.wardId) ?? { id: b.wardId, name: b.wardName, total: 0, free: 0, occupied: 0 };
      w.total += 1;
      if (b.status === "AVAILABLE") w.free += 1;
      if (b.status === "OCCUPIED") w.occupied += 1;
      m.set(b.wardId, w);
    }
    return [...m.values()];
  }, [beds]);

  // The ward board names patients and shows where they are, so it needs an
  // operational role — not merely the ability to look a patient up. Billing and
  // pharmacy are deliberately excluded.
  if (!can("ipd.manage") && !can("admissions.manage")) return <Denied />;

  const shownBeds = wardFilter === "all" ? beds : beds.filter((b) => b.wardId === wardFilter);
  const freeBeds = beds.filter((b) => b.status === "AVAILABLE");

  async function act(path: string, payload: Record<string, unknown>, method = "POST") {
    setBusy(true);
    try {
      await api(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setModal(null);
      setForm({});
      setTarget(null);
      notify("Done");
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not complete that");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Admissions & ward management"
        subtitle="Hospital → building → ward → room → bed. A patient is held by an admission, not by the ward."
        actions={
          can("admissions.manage") ? (
            <Button variant="primary" icon={<BedDouble size={15} />} onClick={() => { setForm({}); setModal("admit"); }}>
              Admit a patient
            </Button>
          ) : undefined
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Beds" value={beds.length} icon={<BedDouble size={16} />} />
        <StatTile label="Occupied" value={beds.filter((b) => b.status === "OCCUPIED").length} tone="brand" />
        <StatTile label="Available" value={freeBeds.length} tone="green" />
        <StatTile
          label="Turning over"
          value={beds.filter((b) => b.status === "CLEANING").length}
          tone="amber"
          icon={<Brush size={16} />}
        />
        <StatTile label="Active admissions" value={admissions.length} tone="brand" />
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-ink-200">
        {([
          ["board", `Ward board (${wards.length})`],
          ["current", `Current admissions (${admissions.length})`],
          ["beds", `Bed management (${beds.length})`],
          ["transfers", `Discharged (${discharged.length})`],
        ] as [TabKey, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cx(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
              tab === k ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:text-ink-700",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <div className="flex items-center gap-2 py-10 text-ink-500"><Loader2 size={16} className="animate-spin" /> Loading…</div>}

      {/* ------------------------------ ward board -------------------------- */}
      {!loading && tab === "board" && (
        wards.length === 0 ? (
          <EmptyState title="No wards configured" hint="Unlock the IPD module and add wards in Hospital setup." icon={<Building2 size={22} />} />
        ) : (
          <div className="space-y-5">
            {wards.map((w) => (
              <Card key={w.id}>
                <CardHeader
                  title={w.name}
                  subtitle={`${w.occupied} of ${w.total} occupied · ${w.free} free`}
                  icon={<Building2 size={16} />}
                />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                  {beds.filter((b) => b.wardId === w.id).map((b) => (
                    <button
                      key={b.id}
                      onClick={() => {
                        if (b.occupant) {
                          const adm = admissions.find((a) => a.id === b.occupant!.admissionId);
                          if (adm && can("admissions.manage")) {
                            setTarget(adm);
                            setForm({});
                            setModal("transfer");
                          }
                        } else if (can("ipd.manage")) {
                          setTarget(b);
                          setForm({ status: b.status });
                          setModal("bed");
                        }
                      }}
                      className={cx(
                        "min-w-0 rounded-lg border px-2 py-2 text-left transition hover:shadow-sm",
                        b.status === "OCCUPIED" ? "border-brand-300 bg-brand-50"
                          : b.status === "AVAILABLE" ? "border-emerald-200 bg-emerald-50"
                          : b.status === "CLEANING" ? "border-amber-200 bg-amber-50"
                          : "border-ink-200 bg-ink-50",
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate text-xs font-semibold text-ink-900">{b.number}</span>
                        <Badge tone={BED_TONE[b.status]}>{b.status.slice(0, 4)}</Badge>
                      </div>
                      {b.occupant ? (
                        <>
                          <p className="mt-1 truncate text-xs font-medium text-ink-800">{b.occupant.patientName}</p>
                          <p className="truncate text-[10px] text-ink-500">{relative(b.occupant.since)}</p>
                          {/*
                            The laboratory, on the board.

                            A ward round happens at the bedside, so this is where
                            "is anything outstanding for this patient" has to be
                            answerable. An unacknowledged critical result is the
                            one thing that must never wait for someone to open
                            another screen.
                          */}
                          {(b.occupant.unacknowledgedCriticals ?? 0) > 0 && (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800 ring-1 ring-rose-200">
                              <AlertTriangle size={9} />
                              {b.occupant.unacknowledgedCriticals} critical
                            </span>
                          )}
                          {(b.occupant.pendingLabs ?? 0) > 0 && (b.occupant.unacknowledgedCriticals ?? 0) === 0 && (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-600">
                              <FlaskConical size={9} />
                              {b.occupant.pendingLabs} lab{b.occupant.pendingLabs === 1 ? "" : "s"} pending
                            </span>
                          )}
                        </>
                      ) : (
                        <p className="mt-1 text-[10px] text-ink-400">{b.status.toLowerCase()}</p>
                      )}
                    </button>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {/* --------------------------- current admissions --------------------- */}
      {!loading && tab === "current" && (
        <Card padded={false}>
          {admissions.length === 0 ? (
            <div className="p-6"><EmptyState title="No active admissions" /></div>
          ) : (
            <Table>
              <thead>
                <Tr><Th>Admission</Th><Th>Patient</Th><Th>Type</Th><Th>Ward / bed</Th><Th>Admitted</Th><Th>Reason</Th><Th /></Tr>
              </thead>
              <tbody>
                {admissions.map((a) => (
                  <Tr key={a.id}>
                    <Td>{a.admissionNo}</Td>
                    <Td>
                      <Link href={`/patients/${a.patientId}`} className="font-medium text-brand-700 hover:underline">
                        {a.patientName}
                      </Link>
                      <span className="ml-2 text-xs text-ink-400">{a.uhid}</span>
                    </Td>
                    <Td><Badge tone="neutral">{a.type}</Badge></Td>
                    <Td>{a.currentWard ? `${a.currentWard.wardName} · ${a.currentWard.bedNumber}` : <Badge tone="amber">no bed</Badge>}</Td>
                    <Td>{fmtDateTime(a.admittedAt)}</Td>
                    <Td>{a.reason || "—"}</Td>
                    <Td>
                      {can("admissions.manage") && (
                        <div className="flex gap-1">
                          {a.currentWard ? (
                            <Button size="sm" icon={<Repeat size={13} />} onClick={() => { setTarget(a); setForm({}); setModal("transfer"); }}>
                              Transfer
                            </Button>
                          ) : (
                            <Button size="sm" icon={<BedDouble size={13} />} onClick={() => { setTarget(a); setForm({}); setModal("transfer"); }}>
                              Assign bed
                            </Button>
                          )}
                          <Button size="sm" variant="primary" icon={<LogOut size={13} />} onClick={() => { setTarget(a); setForm({}); setModal("discharge"); }}>
                            Discharge
                          </Button>
                        </div>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {/* ---------------------------- bed management ------------------------ */}
      {!loading && tab === "beds" && (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <Select value={wardFilter} onChange={(e) => setWardFilter(e.target.value)} className="max-w-xs">
              <option value="all">All wards</option>
              {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </div>
          <Card padded={false}>
            <Table>
              <thead><Tr><Th>Ward</Th><Th>Bed</Th><Th>Status</Th><Th>Occupant</Th><Th>Rate</Th><Th>Note</Th><Th /></Tr></thead>
              <tbody>
                {shownBeds.map((b) => (
                  <Tr key={b.id}>
                    <Td>{b.wardName}</Td><Td>{b.number}</Td>
                    <Td><Badge tone={BED_TONE[b.status]}>{b.status}</Badge></Td>
                    <Td>
                      {b.occupant ? (
                        <Link href={`/patients/${b.occupant.patientId}`} className="text-brand-700 hover:underline">
                          {b.occupant.patientName}
                        </Link>
                      ) : "—"}
                    </Td>
                    <Td>₹{b.dailyRate.toLocaleString("en-IN")}</Td>
                    <Td className="max-w-xs truncate">{b.note || "—"}</Td>
                    <Td>
                      {can("ipd.manage") && !b.occupant && (
                        <Button size="sm" icon={<Wrench size={13} />} onClick={() => { setTarget(b); setForm({ status: b.status }); setModal("bed"); }}>
                          Change status
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {/* ------------------------------ discharged -------------------------- */}
      {!loading && tab === "transfers" && (
        <Card padded={false}>
          {discharged.length === 0 ? (
            <div className="p-6"><EmptyState title="No discharges yet" /></div>
          ) : (
            <Table>
              <thead><Tr><Th>Admission</Th><Th>Patient</Th><Th>Admitted</Th><Th>Discharged</Th><Th>Final diagnosis</Th></Tr></thead>
              <tbody>
                {discharged.map((a) => (
                  <Tr key={a.id}>
                    <Td>{a.admissionNo}</Td>
                    <Td>
                      <Link href={`/patients/${a.patientId}`} className="font-medium text-brand-700 hover:underline">
                        {a.patientName}
                      </Link>
                    </Td>
                    <Td>{fmtDateTime(a.admittedAt)}</Td>
                    <Td>{a.dischargedAt ? fmtDateTime(a.dischargedAt) : "—"}</Td>
                    <Td>{a.finalDiagnosis ?? "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {/* -------------------------------- modals ---------------------------- */}
      <Modal
        open={modal === "admit"} onClose={() => setModal(null)} title="Admit a patient"
        subtitle="Registration and admission are separate: pick an existing patient."
        footer={
          <>
            <Button onClick={() => setModal(null)}>Cancel</Button>
            <Button variant="primary" disabled={busy || !form.patientId} onClick={() => act("/api/admissions", form)}>
              {busy ? "Admitting…" : "Admit"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Patient" hint="Only patients already registered in this hospital">
            <Select value={form.patientId ?? ""} onChange={(e) => setForm({ ...form, patientId: e.target.value })}>
              <option value="">Choose a patient…</option>
              {(d.patients ?? [])
                .filter((p: { status: string }) => p.status !== "ipd")
                .slice(0, 300)
                .map((p: { id: string; name: string; mrn: string }) => (
                  <option key={p.id} value={p.id}>{p.name} — {p.mrn}</option>
                ))}
            </Select>
          </Field>
          <Field label="Admission type">
            <Select value={form.type ?? "elective"} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {["elective", "emergency", "maternity", "daycare", "transfer_in"].map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Bed" hint={`${freeBeds.length} available`}>
            <Select value={form.bedId ?? ""} onChange={(e) => setForm({ ...form, bedId: e.target.value })}>
              <option value="">Assign later</option>
              {freeBeds.map((b) => <option key={b.id} value={b.id}>{b.wardName} · {b.number}</option>)}
            </Select>
          </Field>
          <Field label="Reason"><Input value={form.reason ?? ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal
        open={modal === "transfer"} onClose={() => setModal(null)}
        title={(target as Admission)?.currentWard ? "Transfer to another bed" : "Assign a bed"}
        subtitle={
          (target as Admission)?.currentWard
            ? `Currently ${(target as Admission).currentWard!.wardName} · ${(target as Admission).currentWard!.bedNumber}`
            : "This admission has no bed yet"
        }
        footer={
          <>
            <Button onClick={() => setModal(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy || !form.toBedId || ((target as Admission)?.currentWard ? !form.reason || !form.authorizedBy : false)}
              onClick={() => {
                const adm = target as Admission;
                if (adm.currentWard) act(`/api/admissions/${adm.id}`, { action: "transfer", ...form });
                else act(`/api/admissions/${adm.id}`, { action: "assign-bed", bedId: form.toBedId, reason: form.reason ?? "" });
              }}
            >
              {busy ? "Working…" : "Confirm"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Destination bed">
            <Select value={form.toBedId ?? ""} onChange={(e) => setForm({ ...form, toBedId: e.target.value })}>
              <option value="">Choose a free bed…</option>
              {freeBeds.map((b) => <option key={b.id} value={b.id}>{b.wardName} · {b.number}</option>)}
            </Select>
          </Field>
          <Field label="Reason" hint={(target as Admission)?.currentWard ? "Required for a transfer" : "Optional"}>
            <Input value={form.reason ?? ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
          {(target as Admission)?.currentWard && (
            <Field label="Authorised by" hint="Recorded on the ward assignment and in the audit trail">
              <Input value={form.authorizedBy ?? ""} onChange={(e) => setForm({ ...form, authorizedBy: e.target.value })} />
            </Field>
          )}
          <div className="flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-xs text-ink-700">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-brand-700" />
            <span>
              The old assignment is closed, the old bed is released for turnover, the new bed is occupied and an audit
              entry is written — all in one transaction. If any part fails, none of it happens.
            </span>
          </div>
        </div>
      </Modal>

      <Modal
        open={modal === "discharge"} onClose={() => setModal(null)} title="Discharge" wide
        subtitle={`${(target as Admission)?.patientName} — ${(target as Admission)?.admissionNo}`}
        footer={
          <>
            <Button onClick={() => setModal(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy || !form.finalDiagnosis || !form.dischargeSummary}
              onClick={() => act(`/api/admissions/${(target as Admission).id}`, { action: "discharge", ...form })}
            >
              {busy ? "Discharging…" : "Discharge"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Discharge type">
            <Select value={form.dischargeType ?? "routine"} onChange={(e) => setForm({ ...form, dischargeType: e.target.value })}>
              {["routine", "lama", "referred", "absconded", "expired"].map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Final diagnosis"><Input value={form.finalDiagnosis ?? ""} onChange={(e) => setForm({ ...form, finalDiagnosis: e.target.value })} /></Field>
          <Field label="Procedures"><Input value={form.procedures ?? ""} onChange={(e) => setForm({ ...form, procedures: e.target.value })} /></Field>
          <Field label="Discharge summary"><Textarea rows={5} value={form.dischargeSummary ?? ""} onChange={(e) => setForm({ ...form, dischargeSummary: e.target.value })} /></Field>
          <Field label="Instructions"><Textarea rows={3} value={form.instructions ?? ""} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></Field>
          <Field label="Follow-up date"><Input type="date" value={form.followupDate ?? ""} onChange={(e) => setForm({ ...form, followupDate: e.target.value })} /></Field>
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-ink-700">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-700" />
            <span>The admission is closed, not deleted, and the bed moves to turnover rather than straight back to available.</span>
          </div>
        </div>
      </Modal>

      <Modal
        open={modal === "bed"} onClose={() => setModal(null)} title={`Bed ${(target as Bed)?.number}`}
        subtitle="Housekeeping status only — occupancy comes from an admission"
        footer={
          <>
            <Button onClick={() => setModal(null)}>Cancel</Button>
            <Button variant="primary" disabled={busy}
              onClick={() => act(`/api/beds/${(target as Bed).id}`, { status: form.status, note: form.note ?? "" }, "PATCH")}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Status">
            <Select value={form.status ?? "AVAILABLE"} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {["AVAILABLE", "RESERVED", "CLEANING", "MAINTENANCE", "BLOCKED"].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Note"><Input value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}
