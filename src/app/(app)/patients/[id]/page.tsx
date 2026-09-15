"use client";

/**
 * Patient profile — the single view of one person.
 *
 * Everything on this page comes from `GET /api/patients/:id`, which returns the
 * whole chart already scoped to the signed-in user's hospital and filtered by
 * their permissions. Clinical sections are absent from the payload (not merely
 * hidden) for a user without clinical view.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useOrgData, useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import {
  Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader,
  Select, Table, Td, Textarea, Th, Toggle, Tr,
} from "@/components/ui";
import { api, ApiConflictError, readJson, type ConflictField } from "@/lib/http";
import { useLiveReload } from "@/lib/live";
import { cx, fmtDate, fmtDateTime, relative } from "@/lib/utils";
import {
  Activity, AlertTriangle, ArrowLeft, BedDouble, ClipboardList, FileText, FlaskConical, HeartPulse,
  Loader2, MessageSquare, Pill, Receipt, ShieldCheck, Stethoscope, Syringe, Clock,
} from "lucide-react";

type TabKey =
  | "overview" | "timeline" | "encounters" | "admissions" | "vitals" | "diagnoses"
  | "medications" | "labs" | "documents" | "billing" | "communication" | "consent" | "audit";

const FLAG_TONE: Record<string, "green" | "amber" | "red" | "neutral"> = {
  NORMAL: "green", LOW: "amber", HIGH: "amber", ABNORMAL: "amber",
  CRITICAL_LOW: "red", CRITICAL_HIGH: "red",
};

const EVENT_ICON: Record<string, React.ReactNode> = {
  registration: <ClipboardList size={13} />, import: <ClipboardList size={13} />,
  admission: <BedDouble size={13} />, transfer: <BedDouble size={13} />, discharge: <BedDouble size={13} />,
  vitals: <Activity size={13} />, encounter: <Stethoscope size={13} />, diagnosis: <HeartPulse size={13} />,
  prescription: <Pill size={13} />, lab_order: <FlaskConical size={13} />, lab_sample: <Syringe size={13} />,
  lab_result: <FlaskConical size={13} />, lab_verified: <FlaskConical size={13} />,
  lab_critical: <AlertTriangle size={13} />, document: <FileText size={13} />,
  call: <MessageSquare size={13} />, allergy: <AlertTriangle size={13} />, billing: <Receipt size={13} />,
};

/** The dialogs this screen can open. */
type ModalKey = null | "vitals" | "allergy" | "diagnosis" | "medication" | "encounter" | "lab" | "admit" | "transfer" | "discharge";

interface Profile {
  patient: Record<string, string | number | boolean | null>;
  clinicalVisible: boolean;
  admissions: Record<string, unknown>[];
  currentAdmission: Record<string, unknown> | null;
  wardHistory: Record<string, unknown>[];
  allergies: Record<string, string>[];
  vitals: Record<string, number | string | null>[];
  diagnoses: Record<string, string>[];
  medications: Record<string, unknown>[];
  encounters: Record<string, unknown>[];
  labOrders: Record<string, unknown>[];
  documents: Record<string, unknown>[];
  timeline: Record<string, string>[];
  audit: Record<string, unknown>[];
}

export default function PatientProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, notify } = useStore();
  const d = useOrgData();

  const [tab, setTab] = useState<TabKey>("overview");
  const [data, setData] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKey>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  /*
   * Opening or closing a dialog always clears the form.
   *
   * Nine dialogs on this screen shared one `form` object and none of them reset
   * it, so values typed into "Record vitals" and then cancelled were still
   * present when "Prescribe" opened — and every field in `form` is spread into
   * the request body. A systolic blood pressure could be submitted as part of a
   * prescription.
   *
   * The fix is deliberately not thirty-one calls to `setForm({})` next to
   * thirty-one calls to `setModal(...)`; that is the arrangement that produced
   * the bug, and the next dialog someone adds would reintroduce it. Changing the
   * dialog and clearing its contents are now one operation, so they cannot come
   * apart.
   */
  const openModal = useCallback((next: NonNullable<ModalKey>, seed: Record<string, string> = {}) => {
    setForm(seed);
    setModal(next);
  }, []);
  const closeModal = useCallback(() => {
    setForm({});
    setModal(null);
  }, []);
  const [labCatalog, setLabCatalog] = useState<Record<string, unknown>[]>([]);
  const [beds, setBeds] = useState<Record<string, unknown>[]>([]);
  /** A save refused because a colleague changed the same fields first. */
  const [conflict, setConflict] = useState<null | {
    message: string;
    fields: ConflictField[];
    retry: { path: string; payload: Record<string, unknown>; method: string };
  }>(null);
  /** Set when a colleague changes this chart while it is open. */
  const [staleSince, setStaleSince] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/patients/${id}`);
      const body = await readJson<Profile & { error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? "Could not load this patient");
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this patient");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Keep the chart current.
   *
   * A clinician reading a patient while a nurse records vitals two rooms away
   * should see those vitals, not a snapshot from when the page opened. The
   * stream tells us this patient changed; we reload the chart and mark the
   * moment so the change is visible rather than silent.
   */
  useLiveReload(
    ["patient", "vitals", "medication", "lab", "critical", "admission", "bed", "encounter"],
    useCallback(() => {
      setStaleSince(new Date().toISOString());
      void load();
    }, [load]),
    { patientId: id },
  );

  useEffect(() => {
    if (modal === "lab") void fetch("/api/lab/catalog").then(readJson).then((d) => setLabCatalog((d as { items: Record<string, unknown>[] }).items ?? []));
    if (modal === "admit" || modal === "transfer") {
      void fetch("/api/beds").then(readJson).then((d) => setBeds((d as { items: Record<string, unknown>[] }).items ?? []));
    }
  }, [modal]);

  if (!can("patients.view")) return <Denied />;

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-20 text-ink-500">
        <Loader2 size={16} className="animate-spin" /> Loading patient…
      </div>
    );
  }
  if (error || !data) {
    return (
      <EmptyState
        title={error ?? "Patient not found"}
        hint="This patient may belong to another hospital, or may have been merged."
        icon={<AlertTriangle size={22} />}
      />
    );
  }

  const p = data.patient as Record<string, string>;
  const clinical = data.clinicalVisible;
  const latestVitals = data.vitals?.[0];
  const activeMeds = (data.medications ?? []).filter((m) => (m as { status: string }).status === "ACTIVE");
  const criticalLabs = (data.labOrders ?? []).filter((o) => (o as { critical: boolean }).critical);

  async function submit(path: string, payload: Record<string, unknown>, method = "POST") {
    setBusy(true);
    try {
      /*
       * Demographic saves carry the version this screen was showing. The server
       * refuses the write if someone else has since changed one of the same
       * fields, so two people editing one patient can no longer erase each
       * other's work without either of them being told.
       */
      const isPatientPatch = method === "PATCH" && path === `/api/patients/${id}`;
      const finalPayload = isPatientPatch && !payload.force
        ? { ...payload, expectedVersion: Number(p.version) }
        : payload;

      await api(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(finalPayload) });
      closeModal();
      notify("Saved");
      await load();
    } catch (e) {
      if (e instanceof ApiConflictError) {
        /* Not an error to dismiss — a decision the user has to make. */
        setConflict({ message: e.message, fields: e.conflicts, retry: { path, payload, method } });
        return;
      }
      notify(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "timeline", label: "Timeline", count: data.timeline?.length },
    { key: "encounters", label: "Encounters", count: data.encounters?.length },
    { key: "admissions", label: "Admissions", count: data.admissions?.length },
    { key: "vitals", label: "Vitals", count: data.vitals?.length },
    { key: "diagnoses", label: "Diagnoses", count: data.diagnoses?.length },
    { key: "medications", label: "Medications", count: data.medications?.length },
    { key: "labs", label: "Labs", count: data.labOrders?.length },
    { key: "documents", label: "Documents", count: data.documents?.length },
    { key: "billing", label: "Billing" },
    { key: "communication", label: "Communication" },
    { key: "consent", label: "Consent & privacy" },
    { key: "audit", label: "Audit history", count: data.audit?.length },
  ];

  /** Turn a stored field name into something a clinician would recognise. */
  const fieldLabel = (f: string) =>
    f.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
  const showValue = (v: unknown) =>
    v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);

  return (
    <>
      {/*
        Two people edited the same patient.

        The save was refused rather than applied, so nothing has been lost. This
        shows both values side by side and makes the user choose, because the
        only unsafe option is the one the software used to take silently.
      */}
      <Modal
        open={Boolean(conflict)}
        onClose={() => setConflict(null)}
        title="Someone else changed this patient while you were editing"
        subtitle="Your change was not saved — nothing has been lost"
        footer={
          <>
            <Button onClick={() => { setConflict(null); setForm({}); void load(); }}>
              Discard mine, keep theirs
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                const retry = conflict?.retry;
                setConflict(null);
                if (!retry) return;
                /* An explicit, audited override. The danger was never that a
                   person could overrule a colleague — it was doing so unknowingly. */
                await submit(
                  retry.path,
                  { ...retry.payload, force: true, reason: "Overwrote a concurrent edit after reviewing the differences" },
                  retry.method,
                );
              }}
            >
              Replace theirs with mine
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-ink-700">{conflict?.message}</p>
        <div className="overflow-hidden rounded-lg border border-ink-200">
          <table className="w-full text-xs">
            <thead className="bg-ink-50 text-left text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-3 py-2">Field</th>
                <th className="px-3 py-2">Was, when you opened it</th>
                <th className="px-3 py-2">Now, after their change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {(conflict?.fields ?? []).map((c) => (
                <tr key={c.field}>
                  <td className="px-3 py-2 font-medium text-ink-900">{fieldLabel(c.field)}</td>
                  <td className="px-3 py-2 text-ink-500 line-through">{showValue(c.mine)}</td>
                  <td className="px-3 py-2">
                    <span className="font-medium text-ink-900">{showValue(c.theirs)}</span>
                    <span className="mt-0.5 block text-[11px] text-ink-400">
                      {c.changedBy} · {relative(c.changedAt)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!conflict?.fields.length && (
          <p className="mt-2 text-xs text-ink-500">Reload the patient and make the change again.</p>
        )}
      </Modal>

      {/* Say when the chart changed under the reader, rather than swapping the
          content silently — a clinician needs to know the number they just read
          is not the number on screen any more. */}
      {staleSince && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900">
          <Activity size={13} />
          This chart was updated by someone else {relative(staleSince)} and has been refreshed.
          <button onClick={() => setStaleSince(null)} className="ml-auto font-medium text-brand-700 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      <PageHeader
        title={String(p.fullName)}
        subtitle={`${p.uhid}${p.externalId ? ` · ${p.externalId}` : ""} · ${p.age ?? "?"} years · ${String(p.gender)}${p.dobEstimated ? " (age estimated)" : ""}`}
        actions={
          <>
            <Button icon={<ArrowLeft size={15} />} onClick={() => router.push("/patients")}>Patients</Button>
            {can("vitals.record") && <Button onClick={() => openModal("vitals")} icon={<Activity size={15} />}>Record vitals</Button>}
            {can("encounters.write") && <Button onClick={() => openModal("encounter")} icon={<Stethoscope size={15} />}>New encounter</Button>}
            {can("admissions.manage") && !data.currentAdmission && (
              <Button variant="primary" onClick={() => openModal("admit")} icon={<BedDouble size={15} />}>Admit</Button>
            )}
          </>
        }
      />

      {/* ---------------------- always-visible key facts -------------------- */}
      <div className="mb-5 grid gap-3 lg:grid-cols-4">
        <Card className={cx(data.currentAdmission ? "border-brand-300 bg-brand-50/40" : "")}>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Current admission</p>
          {data.currentAdmission ? (
            <>
              <p className="mt-1 text-sm font-semibold text-ink-900">
                {String((data.currentAdmission as Record<string, string>).admissionNo)}
              </p>
              <p className="text-xs text-ink-600">
                {(data.currentAdmission.currentWard as Record<string, string> | null)
                  ? `${(data.currentAdmission.currentWard as Record<string, string>).wardName} · bed ${(data.currentAdmission.currentWard as Record<string, string>).bedNumber}`
                  : "No bed assigned"}
              </p>
              <p className="mt-1 text-xs text-ink-500">
                since {relative(String((data.currentAdmission as Record<string, string>).admittedAt))}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-500">Not currently admitted</p>
          )}
        </Card>

        <Card className={cx((data.allergies ?? []).length ? "border-rose-300 bg-rose-50/50" : "")}>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Allergies</p>
          {!clinical ? (
            <p className="mt-1 text-sm text-ink-400">[restricted]</p>
          ) : (data.allergies ?? []).length === 0 ? (
            <p className="mt-1 text-sm text-ink-500">None recorded</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {data.allergies.map((a) => (
                <li key={a.id} className="text-sm font-medium text-rose-800">
                  {a.substance}
                  <span className="ml-1 text-xs font-normal text-rose-600">({a.severity.replace("_", " ")})</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Latest vitals</p>
          {!clinical ? (
            <p className="mt-1 text-sm text-ink-400">[restricted]</p>
          ) : latestVitals ? (
            <>
              <p className="mt-1 text-sm font-semibold text-ink-900">
                {latestVitals.systolic ? `${latestVitals.systolic}/${latestVitals.diastolic}` : "—"} mmHg
              </p>
              <p className="text-xs text-ink-600">
                {[
                  latestVitals.pulse && `HR ${latestVitals.pulse}`,
                  latestVitals.spo2 && `SpO₂ ${latestVitals.spo2}%`,
                  latestVitals.temperatureC && `${latestVitals.temperatureC}°C`,
                ].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-1 text-xs text-ink-500">{relative(String(latestVitals.recordedAt))}</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-500">None recorded</p>
          )}
        </Card>

        <Card className={cx(criticalLabs.length ? "border-rose-300 bg-rose-50/50" : "")}>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Active medications & alerts</p>
          {!clinical ? (
            <p className="mt-1 text-sm text-ink-400">[restricted]</p>
          ) : (
            <>
              <p className="mt-1 text-sm font-semibold text-ink-900">{activeMeds.length} active</p>
              {criticalLabs.length > 0 && (
                <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-rose-700">
                  <AlertTriangle size={12} /> {criticalLabs.length} critical lab result(s)
                </p>
              )}
            </>
          )}
        </Card>
      </div>

      <div className="mb-4">
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
      </div>

      {/* --------------------------------- tabs ---------------------------- */}
      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Demographics" icon={<Avatar name={String(p.fullName)} size={28} />} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {[
                ["UHID", p.uhid], ["External id", p.externalId ?? "—"],
                ["Date of birth", p.dateOfBirth ? `${fmtDate(String(p.dateOfBirth))}${p.dobEstimated ? " (estimated)" : ""}` : "—"],
                ["Age", p.age != null ? `${p.age} years` : "—"],
                ["Gender", p.gender], ["Blood group", p.bloodGroup ?? "—"],
                ["Mobile", p.mobile || "—"], ["Alternate mobile", p.altMobile || "—"],
                ["Email", p.email || "—"], ["Language", p.preferredLanguage],
                ["ABHA", p.abhaId ?? "—"], ["Status", p.status],
              ].map(([k, v]) => (
                <div key={String(k)}>
                  <dt className="text-xs text-ink-500">{String(k)}</dt>
                  <dd className="font-medium text-ink-900">{String(v ?? "—")}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Address, contact and cover" />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {[
                ["Address", p.addressLine || "—"], ["Village", p.village || "—"],
                ["Taluka", p.taluka || "—"], ["District", p.district || "—"],
                ["State", p.state || "—"], ["PIN", p.pin || "—"],
                ["Emergency contact", p.emergencyName || "—"],
                ["Relation", p.emergencyRelation || "—"],
                ["Emergency mobile", p.emergencyMobile || "—"],
                ["Insurer", p.insuranceProvider || "—"],
                ["Policy number", p.insuranceNumber || "—"],
                ["Registered", p.createdAt ? fmtDate(String(p.createdAt)) : "—"],
              ].map(([k, v]) => (
                <div key={String(k)}>
                  <dt className="text-xs text-ink-500">{String(k)}</dt>
                  <dd className="font-medium text-ink-900">{String(v ?? "—")}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {clinical && (
            <Card className="lg:col-span-2">
              <CardHeader
                title="Active problems and medication"
                action={
                  <div className="flex gap-2">
                    {can("encounters.write") && <Button size="sm" onClick={() => openModal("allergy")}>Add allergy</Button>}
                    {can("encounters.write") && <Button size="sm" onClick={() => openModal("diagnosis")}>Add diagnosis</Button>}
                    {can("prescriptions.write") && <Button size="sm" onClick={() => openModal("medication")}>Prescribe</Button>}
                    {can("labs.order") && <Button size="sm" onClick={() => openModal("lab")}>Order lab</Button>}
                  </div>
                }
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Diagnoses</p>
                  {data.diagnoses.length === 0 ? <p className="text-sm text-ink-500">None recorded</p> : (
                    <ul className="space-y-1 text-sm">
                      {data.diagnoses.slice(0, 6).map((d) => (
                        <li key={d.id} className="flex items-center gap-2">
                          <Badge tone={d.rank === "primary" ? "brand" : "neutral"}>{d.category}</Badge>
                          <span className="text-ink-900">{d.description}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Active medication</p>
                  {activeMeds.length === 0 ? <p className="text-sm text-ink-500">None active</p> : (
                    <ul className="space-y-1 text-sm">
                      {activeMeds.slice(0, 6).map((m) => {
                        const med = m as Record<string, string>;
                        return (
                          <li key={med.id} className="text-ink-900">
                            <b>{med.medicine}</b> {med.strength} — {med.dose} {med.route} {med.frequency}
                            {med.allergyWarning && (
                              <span className="ml-1 text-xs font-medium text-rose-700">⚠ allergy override recorded</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === "timeline" && (
        <Card>
          <CardHeader title="Patient timeline" subtitle="Every clinical and administrative event, newest first" />
          {data.timeline.length === 0 ? (
            <EmptyState title="Nothing recorded yet" />
          ) : (
            <ol className="relative space-y-4 border-l border-ink-200 pl-6">
              {data.timeline.map((e) => (
                <li key={e.id} className="relative">
                  <span
                    className={cx(
                      "absolute -left-[31px] grid h-6 w-6 place-items-center rounded-full ring-4 ring-white",
                      e.severity === "critical" ? "bg-rose-100 text-rose-700"
                        : e.severity === "warning" ? "bg-amber-100 text-amber-700"
                        : "bg-brand-100 text-brand-700",
                    )}
                  >
                    {EVENT_ICON[e.kind] ?? <Clock size={13} />}
                  </span>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium text-ink-900">{e.title}</span>
                    <Badge tone="neutral">{e.kind.replace("_", " ")}</Badge>
                    <span className="text-xs text-ink-400">{fmtDateTime(e.at)}</span>
                  </div>
                  {e.detail && <p className="mt-0.5 text-sm text-ink-600">{e.detail}</p>}
                  <p className="mt-0.5 text-xs text-ink-400">
                    {e.actor || "system"}
                    {e.entityType === "lab_order" && e.entityId && (
                      <> · <Link href={`/laboratory?order=${e.entityId}`} className="text-brand-700 hover:underline">open lab order</Link></>
                    )}
                    {e.entityType === "admission" && e.entityId && (
                      <> · <Link href={`/admissions?admission=${e.entityId}`} className="text-brand-700 hover:underline">open admission</Link></>
                    )}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      {tab === "encounters" && (
        <Card padded={false}>
          {!clinical ? <div className="p-6"><Denied /></div> : data.encounters.length === 0 ? (
            <div className="p-6"><EmptyState title="No encounters yet" /></div>
          ) : (
            <Table>
              <thead><Tr><Th>Number</Th><Th>Type</Th><Th>Started</Th><Th>Complaint</Th><Th>Assessment</Th><Th>Status</Th><Th>Version</Th></Tr></thead>
              <tbody>
                {data.encounters.map((e) => {
                  const enc = e as Record<string, string>;
                  return (
                    <Tr key={enc.id}>
                      <Td>{enc.encounterNo}</Td>
                      <Td><Badge tone="brand">{enc.type}</Badge></Td>
                      <Td>{fmtDateTime(enc.startedAt)}</Td>
                      <Td>{enc.chiefComplaint || "—"}</Td>
                      <Td>{enc.assessment || "—"}</Td>
                      <Td><Badge tone={enc.status === "completed" ? "green" : "amber"}>{enc.status}</Badge></Td>
                      <Td>v{String((e as Record<string, number>).version)}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === "admissions" && (
        <div className="space-y-4">
          <Card padded={false}>
            {data.admissions.length === 0 ? (
              <div className="p-6"><EmptyState title="Never admitted" /></div>
            ) : (
              <Table>
                <thead><Tr><Th>Number</Th><Th>Type</Th><Th>Admitted</Th><Th>Discharged</Th><Th>Ward / bed</Th><Th>Status</Th><Th>Final diagnosis</Th></Tr></thead>
                <tbody>
                  {data.admissions.map((a) => {
                    const adm = a as Record<string, string> & { currentWard: Record<string, string> | null };
                    return (
                      <Tr key={adm.id}>
                        <Td>{adm.admissionNo}</Td>
                        <Td>{adm.type}</Td>
                        <Td>{fmtDateTime(adm.admittedAt)}</Td>
                        <Td>{adm.dischargedAt ? fmtDateTime(adm.dischargedAt) : "—"}</Td>
                        <Td>{adm.currentWard ? `${adm.currentWard.wardName} · ${adm.currentWard.bedNumber}` : "—"}</Td>
                        <Td><Badge tone={adm.status === "ACTIVE" ? "green" : "neutral"}>{adm.status}</Badge></Td>
                        <Td>{adm.finalDiagnosis ?? "—"}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          {data.currentAdmission && can("admissions.manage") && (
            <Card>
              <CardHeader title="Current stay" subtitle="Ward movements are recorded, never overwritten" />
              <div className="mb-4 flex gap-2">
                <Button onClick={() => openModal("transfer")} icon={<BedDouble size={15} />}>Transfer</Button>
                <Button variant="primary" onClick={() => openModal("discharge")}>Discharge</Button>
              </div>
              <Table>
                <thead><Tr><Th>Ward</Th><Th>Bed</Th><Th>From</Th><Th>To</Th><Th>Reason</Th><Th>Authorised by</Th></Tr></thead>
                <tbody>
                  {data.wardHistory.map((w) => {
                    const wa = w as Record<string, string>;
                    return (
                      <Tr key={wa.id}>
                        <Td>{wa.wardName}</Td><Td>{wa.bedNumber}</Td>
                        <Td>{fmtDateTime(wa.fromAt)}</Td>
                        <Td>{wa.toAt ? fmtDateTime(wa.toAt) : <Badge tone="green">current</Badge>}</Td>
                        <Td>{wa.transferReason || wa.reason || "—"}</Td>
                        <Td>{wa.authorizedBy || wa.assignedBy || "—"}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
      )}

      {tab === "vitals" && (
        <Card padded={false}>
          {!clinical ? <div className="p-6"><Denied /></div> : data.vitals.length === 0 ? (
            <div className="p-6"><EmptyState title="No vitals recorded" hint="Vitals are a time series — each reading is kept." /></div>
          ) : (
            <Table>
              <thead>
                <Tr><Th>Recorded</Th><Th>BP</Th><Th>Pulse</Th><Th>SpO₂</Th><Th>Temp</Th><Th>RR</Th><Th>Glucose</Th><Th>Pain</Th><Th>BMI</Th><Th>By</Th></Tr>
              </thead>
              <tbody>
                {data.vitals.map((v) => (
                  <Tr key={String(v.id)}>
                    <Td>{fmtDateTime(String(v.recordedAt))}</Td>
                    <Td>{v.systolic ? `${v.systolic}/${v.diastolic}` : "—"}</Td>
                    <Td>{v.pulse ?? "—"}</Td>
                    <Td>{v.spo2 ?? "—"}</Td>
                    <Td>{v.temperatureC ?? "—"}</Td>
                    <Td>{v.respiratoryRate ?? "—"}</Td>
                    <Td>{v.bloodGlucose ?? "—"}</Td>
                    <Td>{v.painScore ?? "—"}</Td>
                    <Td>{v.bmi ?? "—"}</Td>
                    <Td>{String(v.recordedBy ?? "")}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === "diagnoses" && (
        <Card padded={false}>
          {!clinical ? <div className="p-6"><Denied /></div> : data.diagnoses.length === 0 ? (
            <div className="p-6"><EmptyState title="No diagnoses recorded" /></div>
          ) : (
            <Table>
              <thead><Tr><Th>Description</Th><Th>Code</Th><Th>Category</Th><Th>Rank</Th><Th>Status</Th><Th>Recorded</Th><Th>By</Th></Tr></thead>
              <tbody>
                {data.diagnoses.map((d) => (
                  <Tr key={d.id}>
                    <Td>{d.description}</Td>
                    <Td>{d.code ? `${d.codeSystem} ${d.code}` : "—"}</Td>
                    <Td>{d.category}</Td><Td>{d.rank}</Td>
                    <Td><Badge tone={d.status === "active" ? "green" : "neutral"}>{d.status}</Badge></Td>
                    <Td>{fmtDate(d.recordedAt)}</Td><Td>{d.recordedBy}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === "medications" && (
        <Card padded={false}>
          {!clinical ? <div className="p-6"><Denied /></div> : data.medications.length === 0 ? (
            <div className="p-6"><EmptyState title="No medication orders" /></div>
          ) : (
            <Table>
              <thead>
                <Tr><Th>Medicine</Th><Th>Dose</Th><Th>Route</Th><Th>Frequency</Th><Th>Duration</Th><Th>Status</Th><Th>Prescribed</Th><Th /></Tr>
              </thead>
              <tbody>
                {data.medications.map((m) => {
                  const med = m as Record<string, string> & { durationDays: number | null };
                  return (
                    <Tr key={med.id}>
                      <Td>
                        <b>{med.medicine}</b> {med.strength}
                        {med.genericName && <span className="block text-xs text-ink-500">{med.genericName}</span>}
                        {med.allergyWarning && (
                          <span className="mt-0.5 block text-xs text-rose-700">⚠ {med.allergyWarning}</span>
                        )}
                      </Td>
                      <Td>{med.dose}</Td><Td>{med.route}</Td><Td>{med.frequency} {med.timing}</Td>
                      <Td>{med.durationDays ? `${med.durationDays} d` : "—"}</Td>
                      <Td><Badge tone={med.status === "ACTIVE" ? "green" : "neutral"}>{med.status}</Badge></Td>
                      <Td>{fmtDate(med.prescribedAt)} · {med.prescribedBy}</Td>
                      <Td>
                        {med.status === "ACTIVE" && can("prescriptions.write") && (
                          <Button
                            size="sm"
                            onClick={() => {
                              const reason = window.prompt("Why is this medication being stopped?");
                              if (reason) void submit(`/api/medications/${med.id}`, { status: "STOPPED", reason }, "PATCH");
                            }}
                          >
                            Stop
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === "labs" && (
        <div className="space-y-4">
          {!clinical ? <Denied /> : data.labOrders.length === 0 ? (
            <EmptyState title="No laboratory orders" />
          ) : (
            data.labOrders.map((o) => {
              const order = o as Record<string, string> & {
                critical: boolean; tests: { id: string; name: string }[];
                results: Record<string, string | number>[];
              };
              return (
                <Card key={order.id} className={cx(order.critical && "border-rose-300")}>
                  <CardHeader
                    title={`${order.orderNo} — ${order.tests.map((t) => t.name).join(", ")}`}
                    subtitle={`Ordered ${fmtDateTime(order.orderedAt)} by ${order.orderedBy} · ${order.priority}`}
                    action={<Badge tone={order.status === "RELEASED" || order.status === "VERIFIED" ? "green" : "amber"}>{order.status}</Badge>}
                  />
                  {order.results.length > 0 && (
                    <Table>
                      <thead><Tr><Th>Analyte</Th><Th>Result</Th><Th>Unit</Th><Th>Reference</Th><Th>Flag</Th><Th>Status</Th></Tr></thead>
                      <tbody>
                        {order.results.map((r) => (
                          <Tr key={String(r.id)}>
                            <Td>{String(r.analyteName)}</Td>
                            <Td><b>{String(r.value)}</b></Td>
                            <Td>{String(r.unit)}</Td>
                            <Td>
                              {r.refText ? String(r.refText)
                                : r.refLow !== null && r.refHigh !== null ? `${r.refLow} – ${r.refHigh}` : "—"}
                            </Td>
                            <Td><Badge tone={FLAG_TONE[String(r.flag)] ?? "neutral"}>{String(r.flag).replace("_", " ")}</Badge></Td>
                            <Td>{String(r.status)}{Number(r.version) > 1 ? ` (v${r.version})` : ""}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </Card>
              );
            })
          )}
        </div>
      )}

      {tab === "documents" && (
        <Card padded={false}>
          {data.documents.length === 0 ? (
            <div className="p-6"><EmptyState title="No documents" hint="Scans, consents and reports attached to this patient appear here." /></div>
          ) : (
            <Table>
              <thead><Tr><Th>Title</Th><Th>Category</Th><Th>Uploaded</Th><Th>By</Th></Tr></thead>
              <tbody>
                {data.documents.map((d) => {
                  const doc = d as Record<string, string>;
                  return (
                    <Tr key={doc.id}>
                      <Td>{doc.title}</Td><Td>{doc.category}</Td>
                      <Td>{fmtDateTime(doc.uploadedAt)}</Td><Td>{doc.uploadedBy}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === "billing" && (
        <Card padded={false}>
          {(() => {
            const invoices = (d.invoices ?? []).filter((i: { patientId: string }) => i.patientId === id);
            if (!can("billing.manage")) return <div className="p-6"><Denied /></div>;
            if (!invoices.length) return <div className="p-6"><EmptyState title="No invoices for this patient" /></div>;
            return (
              <Table>
                <thead><Tr><Th>Number</Th><Th>Issued</Th><Th>Status</Th><Th>Payer</Th><Th>Paid</Th></Tr></thead>
                <tbody>
                  {invoices.map((inv: unknown) => {
                    const i = inv as Record<string, string | number>;
                    return (
                      <Tr key={String(i.id)}>
                        <Td>{String(i.number)}</Td>
                        <Td>{fmtDate(String(i.issuedAt))}</Td>
                        <Td><Badge tone={i.status === "paid" ? "green" : "amber"}>{String(i.status)}</Badge></Td>
                        <Td>{String(i.payer)}</Td>
                        <Td>₹{Number(i.paid).toLocaleString("en-IN")}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            );
          })()}
        </Card>
      )}

      {tab === "communication" && (
        <Card padded={false}>
          {(() => {
            const calls = (d.calls ?? []).filter((c: { patientId: string | null }) => c.patientId === id);
            if (!calls.length) return <div className="p-6"><EmptyState title="No calls or messages yet" /></div>;
            return (
              <Table>
                <thead><Tr><Th>When</Th><Th>Direction</Th><Th>Outcome</Th><Th>Risk</Th><Th>Duration</Th></Tr></thead>
                <tbody>
                  {calls.map((call: unknown) => {
                    const c = call as Record<string, string | number>;
                    return (
                      <Tr key={String(c.id)}>
                        <Td>{fmtDateTime(String(c.startedAt))}</Td>
                        <Td>{String(c.direction)}</Td>
                        <Td>{String(c.outcome)}</Td>
                        <Td><Badge tone={c.risk === "red" ? "red" : c.risk === "amber" ? "amber" : "green"}>{String(c.risk)}</Badge></Td>
                        <Td>{Math.round(Number(c.durationSeconds) / 60)} min</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            );
          })()}
        </Card>
      )}

      {tab === "consent" && (
        <Card>
          <CardHeader
            title="Consent & privacy"
            subtitle="Checked on the server before every call. Withdrawal takes effect on the next attempt."
            icon={<ShieldCheck size={16} />}
          />
          {(() => {
            const consent = (p.consent as unknown as Record<string, boolean | string>) ?? {};
            const set = (key: string, value: boolean) =>
              submit(`/api/patients/${id}`, { consent: { ...consent, [key]: value } }, "PATCH");
            const editable = can("patients.edit");
            return (
              <div className="max-w-xl divide-y divide-ink-100">
                {([
                  ["clinicalCalls", "Clinical follow-up calls", "Post-discharge and care protocol calls"],
                  ["whatsapp", "WhatsApp / SMS messaging", "Reminders, results notifications and two-way messages"],
                  ["recording", "Call recording", "Audio is only written to storage when this is granted"],
                  ["marketing", "Marketing and health campaigns", "Never bundled into a clinical call"],
                ] as [string, string, string][]).map(([key, label, description]) => (
                  <Toggle
                    key={key}
                    label={label}
                    description={description}
                    checked={Boolean(consent[key])}
                    onChange={(v) => (editable ? set(key, v) : notify("Your role cannot change consent"))}
                  />
                ))}
                <p className="pt-3 text-xs text-ink-500">
                  Consent version {String(consent.version ?? "—")}
                  {consent.updatedAt ? ` · last updated ${fmtDateTime(String(consent.updatedAt))}` : ""}
                </p>
              </div>
            );
          })()}
        </Card>
      )}

      {tab === "audit" && (
        <Card padded={false}>
          {data.audit.length === 0 ? (
            <div className="p-6"><EmptyState title="No audit entries visible" hint="Audit history needs the audit.view permission." /></div>
          ) : (
            <Table>
              <thead><Tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Entity</Th><Th>Reason</Th><Th>Changed</Th></Tr></thead>
              <tbody>
                {data.audit.map((a) => {
                  const row = a as Record<string, string> & { before: unknown; after: unknown };
                  return (
                    <Tr key={row.id}>
                      <Td>{fmtDateTime(row.at)}</Td>
                      <Td>{row.actor} <span className="text-xs text-ink-400">({row.actorRole})</span></Td>
                      <Td><Badge tone="neutral">{row.action}</Badge></Td>
                      <Td>{row.entityType}</Td>
                      <Td>{row.reason || "—"}</Td>
                      <Td>
                        {row.before || row.after ? (
                          <details>
                            <summary className="cursor-pointer text-xs text-brand-700">before / after</summary>
                            <pre className="mt-1 max-h-40 overflow-auto rounded bg-ink-900 p-2 text-[10px] text-ink-100">
                              {JSON.stringify({ before: row.before, after: row.after }, null, 2)}
                            </pre>
                          </details>
                        ) : "—"}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {/* -------------------------------- modals --------------------------- */}
      <Modal
        open={modal === "vitals"} onClose={() => closeModal()} title="Record vitals"
        subtitle="Each reading is stored with its own timestamp — nothing is overwritten"
        footer={
          <>
            <Button onClick={() => closeModal()}>Cancel</Button>
            <Button
              variant="primary" disabled={busy}
              onClick={() => submit(`/api/patients/${id}/vitals`, {
                ...form,
                admissionId: (data.currentAdmission as Record<string, string> | null)?.id ?? null,
              })}
            >
              {busy ? "Saving…" : "Save vitals"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ["systolic", "Systolic (mmHg)"], ["diastolic", "Diastolic (mmHg)"], ["pulse", "Pulse (bpm)"],
            ["spo2", "SpO₂ (%)"], ["temperatureC", "Temperature (°C)"], ["respiratoryRate", "Respiratory rate"],
            ["heightCm", "Height (cm)"], ["weightKg", "Weight (kg)"], ["bloodGlucose", "Blood glucose (mg/dL)"],
            ["painScore", "Pain score (0–10)"],
          ].map(([k, label]) => (
            <Field key={k} label={label}>
              <Input type="number" step="any" value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </Field>
          ))}
          <Field label="Note" className="sm:col-span-2">
            <Input value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={modal === "allergy"} onClose={() => closeModal()} title="Record an allergy"
        footer={
          <>
            <Button onClick={() => closeModal()}>Cancel</Button>
            <Button variant="primary" disabled={busy || !form.substance}
              onClick={() => submit(`/api/patients/${id}/allergies`, form)}>Save</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Substance"><Input value={form.substance ?? ""} onChange={(e) => setForm({ ...form, substance: e.target.value })} /></Field>
          <Field label="Reaction"><Input value={form.reaction ?? ""} onChange={(e) => setForm({ ...form, reaction: e.target.value })} /></Field>
          <Field label="Severity">
            <Select value={form.severity ?? "moderate"} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {["mild", "moderate", "severe", "life_threatening"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </Select>
          </Field>
          <Field label="Category">
            <Select value={form.category ?? "medication"} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {["medication", "food", "environmental", "unknown"].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
        </div>
      </Modal>

      <Modal
        open={modal === "diagnosis"} onClose={() => closeModal()} title="Add a diagnosis"
        footer={
          <>
            <Button onClick={() => closeModal()}>Cancel</Button>
            <Button variant="primary" disabled={busy || !form.description}
              onClick={() => submit(`/api/patients/${id}/diagnoses`, {
                ...form, admissionId: (data.currentAdmission as Record<string, string> | null)?.id ?? null,
              })}>Save</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Description"><Input value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Coding system"><Input placeholder="ICD-10" value={form.codeSystem ?? ""} onChange={(e) => setForm({ ...form, codeSystem: e.target.value })} /></Field>
            <Field label="Code"><Input value={form.code ?? ""} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
            <Field label="Category">
              <Select value={form.category ?? "provisional"} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {["provisional", "final", "differential", "comorbidity"].map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Rank">
              <Select value={form.rank ?? "secondary"} onChange={(e) => setForm({ ...form, rank: e.target.value })}>
                <option value="primary">primary</option><option value="secondary">secondary</option>
              </Select>
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={modal === "medication"} onClose={() => closeModal()} title="Prescribe"
        subtitle="Structured fields — the prescription is not free text"
        footer={
          <>
            <Button onClick={() => closeModal()}>Cancel</Button>
            <Button variant="primary" disabled={busy || !form.medicine || !form.dose || !form.frequency}
              onClick={() => submit(`/api/patients/${id}/medications`, {
                ...form, durationDays: form.durationDays ? Number(form.durationDays) : undefined,
                admissionId: (data.currentAdmission as Record<string, string> | null)?.id ?? null,
              })}>Prescribe</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Medicine"><Input value={form.medicine ?? ""} onChange={(e) => setForm({ ...form, medicine: e.target.value })} /></Field>
          <Field label="Generic name"><Input value={form.genericName ?? ""} onChange={(e) => setForm({ ...form, genericName: e.target.value })} /></Field>
          <Field label="Strength"><Input placeholder="500 mg" value={form.strength ?? ""} onChange={(e) => setForm({ ...form, strength: e.target.value })} /></Field>
          <Field label="Form"><Input placeholder="tablet" value={form.form ?? ""} onChange={(e) => setForm({ ...form, form: e.target.value })} /></Field>
          <Field label="Dose"><Input placeholder="1 tablet" value={form.dose ?? ""} onChange={(e) => setForm({ ...form, dose: e.target.value })} /></Field>
          <Field label="Route">
            <Select value={form.route ?? "oral"} onChange={(e) => setForm({ ...form, route: e.target.value })}>
              {["oral", "iv", "im", "sc", "topical", "inhaled", "rectal", "ophthalmic", "nasal", "other"].map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Frequency"><Input placeholder="twice daily" value={form.frequency ?? ""} onChange={(e) => setForm({ ...form, frequency: e.target.value })} /></Field>
          <Field label="Timing"><Input placeholder="after food" value={form.timing ?? ""} onChange={(e) => setForm({ ...form, timing: e.target.value })} /></Field>
          <Field label="Duration (days)"><Input type="number" value={form.durationDays ?? ""} onChange={(e) => setForm({ ...form, durationDays: e.target.value })} /></Field>
          <Field label="Instructions" className="sm:col-span-2">
            <Textarea rows={2} value={form.instructions ?? ""} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
          </Field>
          <Field label="Allergy override reason (only if warned)" className="sm:col-span-2"
            hint="The warning assists the prescriber — it does not replace clinical judgment">
            <Input value={form.allergyOverrideReason ?? ""} onChange={(e) => setForm({ ...form, allergyOverrideReason: e.target.value })} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={modal === "encounter"} onClose={() => closeModal()} title="New clinical encounter" wide
        footer={
          <>
            <Button onClick={() => closeModal()}>Cancel</Button>
            <Button variant="primary" disabled={busy}
              onClick={() => submit("/api/encounters", {
                ...form, patientId: id,
                admissionId: (data.currentAdmission as Record<string, string> | null)?.id ?? null,
              })}>Create encounter</Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="Encounter type">
            <Select value={form.type ?? "opd"} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {["opd", "ipd", "emergency", "teleconsult", "followup"].map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          {[
            ["chiefComplaint", "Chief complaint"], ["hpi", "History of present illness"],
            ["pastHistory", "Past medical history"], ["familyHistory", "Family history"],
            ["examination", "Clinical examination"], ["assessment", "Assessment"],
            ["plan", "Plan"], ["procedures", "Procedures"], ["followupInstructions", "Follow-up instructions"],
          ].map(([k, label]) => (
            <Field key={k} label={label}>
              <Textarea rows={2} value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
      </Modal>

      <Modal
        open={modal === "lab"} onClose={() => closeModal()} title="Order laboratory tests"
        footer={
          <>
            <Button onClick={() => closeModal()}>Cancel</Button>
            <Button variant="primary" disabled={busy || !form.testCode}
              onClick={() => submit("/api/lab/orders", {
                patientId: id, testCodes: [form.testCode], priority: form.priority ?? "routine",
                clinicalNote: form.clinicalNote ?? "",
                admissionId: (data.currentAdmission as Record<string, string> | null)?.id ?? null,
              })}>Order</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Test">
            <Select value={form.testCode ?? ""} onChange={(e) => setForm({ ...form, testCode: e.target.value })}>
              <option value="">Choose a test…</option>
              {labCatalog.map((t) => {
                const test = t as Record<string, string>;
                return <option key={test.id} value={test.code}>{test.name} ({test.category})</option>;
              })}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={form.priority ?? "routine"} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {["routine", "urgent", "stat"].map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label="Clinical note"><Input value={form.clinicalNote ?? ""} onChange={(e) => setForm({ ...form, clinicalNote: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal
        open={modal === "admit"} onClose={() => closeModal()} title="Create admission"
        subtitle="An admission is a separate record — the ward is never stored on the patient"
        footer={
          <>
            <Button onClick={() => closeModal()}>Cancel</Button>
            <Button variant="primary" disabled={busy}
              onClick={() => submit("/api/admissions", { ...form, patientId: id })}>Admit</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Admission type">
            <Select value={form.type ?? "elective"} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {["elective", "emergency", "maternity", "daycare", "transfer_in"].map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Available bed" hint="Only free beds are listed; the assignment is atomic">
            <Select value={form.bedId ?? ""} onChange={(e) => setForm({ ...form, bedId: e.target.value })}>
              <option value="">No bed yet</option>
              {beds.filter((b) => (b as { status: string }).status === "AVAILABLE").map((b) => {
                const bed = b as Record<string, string>;
                return <option key={bed.id} value={bed.id}>{bed.wardName} · {bed.number}</option>;
              })}
            </Select>
          </Field>
          <Field label="Reason for admission"><Input value={form.reason ?? ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
          <Field label="Referred by"><Input value={form.referredBy ?? ""} onChange={(e) => setForm({ ...form, referredBy: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal
        open={modal === "transfer"} onClose={() => closeModal()} title="Transfer to another bed"
        footer={
          <>
            <Button onClick={() => closeModal()}>Cancel</Button>
            <Button variant="primary" disabled={busy || !form.toBedId || !form.reason || !form.authorizedBy}
              onClick={() => submit(`/api/admissions/${(data.currentAdmission as Record<string, string>).id}`, { action: "transfer", ...form })}>
              Confirm transfer
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Destination bed">
            <Select value={form.toBedId ?? ""} onChange={(e) => setForm({ ...form, toBedId: e.target.value })}>
              <option value="">Choose a free bed…</option>
              {beds.filter((b) => (b as { status: string }).status === "AVAILABLE").map((b) => {
                const bed = b as Record<string, string>;
                return <option key={bed.id} value={bed.id}>{bed.wardName} · {bed.number}</option>;
              })}
            </Select>
          </Field>
          <Field label="Transfer reason"><Input value={form.reason ?? ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
          <Field label="Authorised by"><Input value={form.authorizedBy ?? ""} onChange={(e) => setForm({ ...form, authorizedBy: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal
        open={modal === "discharge"} onClose={() => closeModal()} title="Discharge" wide
        subtitle="The admission is closed and the bed released. The record is kept in full."
        footer={
          <>
            <Button onClick={() => closeModal()}>Cancel</Button>
            <Button variant="primary" disabled={busy || !form.finalDiagnosis || !form.dischargeSummary}
              onClick={() => submit(`/api/admissions/${(data.currentAdmission as Record<string, string>).id}`, { action: "discharge", ...form })}>
              Discharge
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
          <Field label="Procedures performed"><Input value={form.procedures ?? ""} onChange={(e) => setForm({ ...form, procedures: e.target.value })} /></Field>
          <Field label="Discharge summary"><Textarea rows={5} value={form.dischargeSummary ?? ""} onChange={(e) => setForm({ ...form, dischargeSummary: e.target.value })} /></Field>
          <Field label="Instructions on discharge"><Textarea rows={3} value={form.instructions ?? ""} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></Field>
          <Field label="Follow-up date"><Input type="date" value={form.followupDate ?? ""} onChange={(e) => setForm({ ...form, followupDate: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}

/** Local tab strip (the shared one is generic over a union, which we widen here). */
function Tabs({ tabs, active, onChange }: {
  tabs: { key: TabKey; label: string; count?: number }[];
  active: TabKey;
  onChange: (k: TabKey) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-ink-200">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cx(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition",
            active === t.key ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:border-ink-300 hover:text-ink-700",
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={cx("ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
              active === t.key ? "bg-brand-100 text-brand-700" : "bg-ink-100 text-ink-500")}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
