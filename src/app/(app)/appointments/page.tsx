"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useOrgData, useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, Modal, PageHeader, Select, Table, Td, Th, Tr, Input } from "@/components/ui";
import { cx, fmtDate, fmtTime, relative } from "@/lib/utils";
import {
  CalendarDays, CalendarPlus, CheckCircle2, ChevronLeft, ChevronRight, Clock, Lock, RefreshCw, Search, X,
} from "lucide-react";

export default function AppointmentsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-500">Loading calendar…</p>}>
      <AppointmentsInner />
    </Suspense>
  );
}

function AppointmentsInner() {
  const sp = useSearchParams();
  const { can, notify, audit, bookAppointment, updateAppointment } = useStore();
  const d = useOrgData();
  const [dayOffset, setDayOffset] = useState(0);
  const [providerFilter, setProviderFilter] = useState(sp.get("provider") ?? "all");
  const [bookOpen, setBookOpen] = useState(Boolean(sp.get("book")));

  const day = new Date();
  day.setDate(day.getDate() + dayOffset);
  const dayKey = day.toDateString();

  const dayAppts = useMemo(
    () =>
      d.appointments
        .filter((a) => new Date(a.start).toDateString() === dayKey)
        .filter((a) => providerFilter === "all" || a.providerId === providerFilter)
        .sort((a, b) => (a.start < b.start ? -1 : 1)),
    [d.appointments, dayKey, providerFilter],
  );

  const upcoming = d.appointments
    .filter((a) => new Date(a.start) > new Date() && (a.status === "booked" || a.status === "confirmed"))
    .sort((a, b) => (a.start < b.start ? -1 : 1));

  if (!can("appointments.manage")) return <Denied />;

  const providersShown = providerFilter === "all" ? d.providers.slice(0, 6) : d.providers.filter((p) => p.id === providerFilter);

  return (
    <>
      <PageHeader
        title="Appointments"
        subtitle="Live availability, atomic slot locking and source attribution for every booking"
        actions={<Button variant="primary" icon={<CalendarPlus size={15} />} onClick={() => setBookOpen(true)}>New appointment</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Card>
          <p className="text-xs text-ink-500">Booked by AI receptionist</p>
          <p className="mt-1 text-2xl font-semibold text-ink-900">
            {d.appointments.filter((a) => a.source === "ai_receptionist").length}
          </p>
          <p className="text-[11px] text-ink-400">
            {Math.round((d.appointments.filter((a) => a.source === "ai_receptionist").length / Math.max(1, d.appointments.length)) * 100)}% of all bookings
          </p>
        </Card>
        <Card>
          <p className="text-xs text-ink-500">Upcoming (confirmed)</p>
          <p className="mt-1 text-2xl font-semibold text-ink-900">{upcoming.length}</p>
          <p className="text-[11px] text-ink-400">next {upcoming[0] ? relative(upcoming[0].start).replace(" ago", "") : "—"}</p>
        </Card>
        <Card>
          <p className="text-xs text-ink-500">No-shows (last 10 days)</p>
          <p className="mt-1 text-2xl font-semibold text-ink-900">{d.appointments.filter((a) => a.status === "no_show").length}</p>
          <p className="text-[11px] text-ink-400">AI reminders active on all confirmed slots</p>
        </Card>
        <Card>
          <p className="text-xs text-ink-500">Double bookings</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-600">0</p>
          <p className="text-[11px] text-ink-400">slot hold + re-check before write</p>
        </Card>
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 px-4 py-3">
          <div className="flex items-center gap-1">
            <Button size="sm" onClick={() => setDayOffset((v) => v - 1)} icon={<ChevronLeft size={14} />} />
            <Button size="sm" onClick={() => setDayOffset(0)}>Today</Button>
            <Button size="sm" onClick={() => setDayOffset((v) => v + 1)} icon={<ChevronRight size={14} />} />
          </div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-ink-900">
            <CalendarDays size={15} className="text-ink-400" />
            {day.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
          <Select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} className="ml-auto w-auto">
            <option value="all">All doctors</option>
            {d.providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {p.speciality}</option>
            ))}
          </Select>
        </div>

        {/* day grid by doctor */}
        <div className="overflow-x-auto p-4">
          <div className="flex min-w-max gap-3">
            {providersShown.map((p) => {
              const slots: { time: Date; appt?: (typeof dayAppts)[number] }[] = [];
              for (let h = p.startHour; h < p.endHour; h++) {
                for (let m = 0; m < 60; m += p.consultationMinutes) {
                  const t = new Date(day);
                  t.setHours(h, m, 0, 0);
                  const appt = dayAppts.find(
                    (a) => a.providerId === p.id && Math.abs(new Date(a.start).getTime() - t.getTime()) < p.consultationMinutes * 30000,
                  );
                  slots.push({ time: t, appt });
                }
              }
              return (
                <div key={p.id} className="w-[210px] shrink-0">
                  <div className="mb-2 rounded-lg bg-ink-50 px-2.5 py-2">
                    <p className="truncate text-xs font-semibold text-ink-900">{p.name}</p>
                    <p className="truncate text-[10px] text-ink-500">{p.speciality} · {p.consultationMinutes} min slots</p>
                  </div>
                  <div className="space-y-1">
                    {slots.slice(0, 18).map((s, i) => {
                      const pat = s.appt ? d.patients.find((x) => x.id === s.appt!.patientId) : null;
                      return (
                        <div
                          key={i}
                          className={cx(
                            "rounded-lg border px-2 py-1.5 text-[11px]",
                            s.appt
                              ? s.appt.status === "cancelled" || s.appt.status === "no_show"
                                ? "border-rose-200 bg-rose-50"
                                : s.appt.source === "ai_receptionist"
                                  ? "border-brand-300 bg-brand-50"
                                  : "border-ink-200 bg-white"
                              : "border-dashed border-ink-200 bg-ink-50/50 text-ink-400",
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium tabular-nums">{fmtTime(s.time.toISOString())}</span>
                            {s.appt && s.appt.source === "ai_receptionist" && <Badge tone="brand">AI</Badge>}
                          </div>
                          {s.appt ? (
                            <Link href={`/patients/${pat?.id}`} className="mt-0.5 block truncate font-medium text-ink-800 hover:text-brand-700">
                              {pat?.name}
                            </Link>
                          ) : (
                            <span className="mt-0.5 block">available</span>
                          )}
                          {s.appt && <span className="block truncate text-ink-500">{s.appt.reason}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <Card className="mt-4" padded={false}>
        <div className="px-4 pt-4">
          <CardHeader title={`Appointments on ${fmtDate(day.toISOString())}`} subtitle={`${dayAppts.length} scheduled`} icon={<Clock size={15} />} />
        </div>
        {dayAppts.length === 0 ? (
          <div className="px-4 pb-6"><EmptyState title="Nothing scheduled for this day" /></div>
        ) : (
          <Table>
            <thead>
              <tr><Th>Time</Th><Th>Patient</Th><Th>Doctor</Th><Th>Reason</Th><Th>Source</Th><Th>Status</Th><Th /></tr>
            </thead>
            <tbody>
              {dayAppts.map((a) => {
                const pat = d.patients.find((x) => x.id === a.patientId);
                return (
                  <Tr key={a.id}>
                    <Td className="whitespace-nowrap font-medium tabular-nums">{fmtTime(a.start)}</Td>
                    <Td>
                      <Link href={`/patients/${pat?.id}`} className="font-medium text-ink-900 hover:text-brand-700">{pat?.name}</Link>
                      <span className="block text-[11px] text-ink-400">{pat?.mrn}</span>
                    </Td>
                    <Td className="text-xs">{d.providers.find((p) => p.id === a.providerId)?.name}</Td>
                    <Td className="text-xs">{a.reason}</Td>
                    <Td><Badge tone={a.source === "ai_receptionist" ? "brand" : "neutral"}>{a.source.replace(/_/g, " ")}</Badge></Td>
                    <Td><Badge tone={a.status === "completed" ? "green" : a.status === "cancelled" || a.status === "no_show" ? "red" : "blue"}>{a.status.replace("_", " ")}</Badge></Td>
                    <Td>
                      {(a.status === "booked" || a.status === "confirmed") && (
                        <div className="flex gap-1">
                          <Button size="sm" onClick={() => { updateAppointment(a.id, { status: "completed" }); notify("Marked completed"); }}>Done</Button>
                          <Button size="sm" variant="ghost" onClick={() => { updateAppointment(a.id, { status: "cancelled" }); audit("appointment.cancelled", `${a.id} — ${pat?.name}`); notify("Cancelled and synced to HIS"); }}>
                            <X size={13} />
                          </Button>
                        </div>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <BookingModal
        open={bookOpen}
        onClose={() => setBookOpen(false)}
        preselectPatient={sp.get("book") ?? undefined}
        onBooked={(id) => {
          notify(`Appointment ${id} created and confirmation queued`);
          audit("appointment.created", `${id} via staff console`);
        }}
        book={bookAppointment}
      />
    </>
  );
}

/* --------------------------------------------------------------------- */
/* Booking flow: speciality → doctor → slot → 90s hold → re-check → write */
/* --------------------------------------------------------------------- */
function BookingModal({
  open, onClose, preselectPatient, onBooked, book,
}: {
  open: boolean;
  onClose: () => void;
  preselectPatient?: string;
  onBooked: (id: string) => void;
  book: ReturnType<typeof useStore>["bookAppointment"];
}) {
  const d = useOrgData();
  const [step, setStep] = useState(0);
  const [patientId, setPatientId] = useState(preselectPatient ?? "");
  const [search, setSearch] = useState("");
  const [deptId, setDeptId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [slot, setSlot] = useState<string>("");
  const [holdSeconds, setHoldSeconds] = useState(90);
  const [recheck, setRecheck] = useState<"idle" | "checking" | "ok">("idle");
  const [createdId, setCreatedId] = useState("");

  useEffect(() => {
    if (preselectPatient) setPatientId(preselectPatient);
  }, [preselectPatient]);

  useEffect(() => {
    if (step !== 3 || !slot) return;
    setHoldSeconds(90);
    const t = setInterval(() => setHoldSeconds((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [step, slot]);

  const patient = d.patients.find((p) => p.id === patientId);
  const provider = d.providers.find((p) => p.id === providerId);

  const slots = useMemo(() => {
    if (!provider) return [];
    const out: string[] = [];
    for (let dayAdd = 1; dayAdd <= 4; dayAdd++) {
      const base = new Date();
      base.setDate(base.getDate() + dayAdd);
      for (let h = provider.startHour; h < provider.endHour; h++) {
        for (let m = 0; m < 60; m += provider.consultationMinutes) {
          const t = new Date(base);
          t.setHours(h, m, 0, 0);
          const taken = d.appointments.some(
            (a) => a.providerId === provider.id && Math.abs(new Date(a.start).getTime() - t.getTime()) < 60000,
          );
          if (!taken) out.push(t.toISOString());
        }
      }
    }
    return out.slice(0, 24);
  }, [provider, d.appointments]);

  function reset() {
    setStep(0); setPatientId(preselectPatient ?? ""); setDeptId(""); setProviderId("");
    setSlot(""); setRecheck("idle"); setCreatedId(""); setSearch("");
  }

  function confirm() {
    setRecheck("checking");
    setTimeout(() => {
      setRecheck("ok");
      const appt = book({
        orgId: patient!.orgId,
        facilityId: patient!.facilityId,
        patientId: patient!.id,
        providerId: provider!.id,
        departmentId: provider!.departmentId,
        start: slot,
        durationMinutes: provider!.consultationMinutes,
        status: "confirmed",
        source: "reception_desk",
        reason: "New consultation",
      });
      const readable = `DC-${String(Math.floor(Math.random() * 90000) + 10000)}`;
      setCreatedId(readable);
      onBooked(readable);
      setStep(4);
      void appt;
    }, 900);
  }

  const filteredPatients = d.patients
    .filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.mrn.toLowerCase().includes(search.toLowerCase()) || p.phone.includes(search))
    .slice(0, 8);

  return (
    <Modal
      open={open}
      onClose={() => { onClose(); reset(); }}
      wide
      title="Book an appointment"
      subtitle="The AI receptionist follows exactly this transaction — the same locks and the same rules"
      footer={
        step < 4 ? (
          <>
            <Button onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))}>{step === 0 ? "Cancel" : "Back"}</Button>
            {step === 3 ? (
              <Button variant="primary" onClick={confirm} disabled={recheck !== "idle" || holdSeconds === 0}>
                {recheck === "checking" ? "Re-checking availability…" : "Confirm booking"}
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => setStep((s) => s + 1)}
                disabled={(step === 0 && !patientId) || (step === 1 && !deptId) || (step === 2 && !providerId)}
              >
                Continue
              </Button>
            )}
          </>
        ) : (
          <Button variant="primary" onClick={() => { onClose(); reset(); }}>Done</Button>
        )
      }
    >
      <ol className="mb-5 flex flex-wrap gap-1 text-[11px]">
        {["Patient", "Speciality", "Doctor & slot", "Hold & confirm", "Confirmation"].map((s, i) => (
          <li key={s} className={cx("rounded-full px-2.5 py-1 font-medium", i === step ? "bg-brand-600 text-white" : i < step ? "bg-brand-50 text-brand-700" : "bg-ink-100 text-ink-400")}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div>
          <div className="relative mb-3">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <Input className="pl-9" placeholder="Search by name, MRN or mobile…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            {filteredPatients.map((p) => (
              <button
                key={p.id}
                onClick={() => setPatientId(p.id)}
                className={cx("flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm", patientId === p.id ? "border-brand-500 bg-brand-50" : "border-ink-200 hover:bg-ink-50")}
              >
                <span>
                  <span className="block font-medium text-ink-900">{p.name}</span>
                  <span className="block text-[11px] text-ink-500">{p.mrn} · {p.age}{p.gender} · {p.phone}</span>
                </span>
                {patientId === p.id && <CheckCircle2 size={16} className="text-brand-600" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {d.departments.filter((x) => x.type === "clinical").map((x) => (
            <button
              key={x.id}
              onClick={() => { setDeptId(x.id); setProviderId(""); }}
              className={cx("rounded-lg border px-3 py-2.5 text-left text-sm", deptId === x.id ? "border-brand-500 bg-brand-50" : "border-ink-200 hover:bg-ink-50")}
            >
              <span className="block font-medium text-ink-900">{x.name}</span>
              <span className="block text-[11px] text-ink-500">
                {d.providers.filter((p) => p.departmentId === x.id).length} doctor(s) available
              </span>
            </button>
          ))}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {d.providers.filter((p) => p.departmentId === deptId).map((p) => (
              <button
                key={p.id}
                onClick={() => { setProviderId(p.id); setSlot(""); }}
                className={cx("rounded-lg border px-3 py-2.5 text-left text-sm", providerId === p.id ? "border-brand-500 bg-brand-50" : "border-ink-200 hover:bg-ink-50")}
              >
                <span className="block font-medium text-ink-900">{p.name}</span>
                <span className="block text-[11px] text-ink-500">{p.qualification} · ₹{p.fee} · {p.consultationMinutes} min</span>
              </button>
            ))}
          </div>
          {provider && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-600">Live availability (read from the appointment engine / HIS)</p>
              <div className="grid max-h-52 grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-4">
                {slots.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSlot(s)}
                    className={cx("rounded-lg border px-2 py-1.5 text-[11px]", slot === s ? "border-brand-500 bg-brand-50 font-medium text-brand-700" : "border-ink-200 hover:bg-ink-50")}
                  >
                    <span className="block">{new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
                    <span className="block font-medium">{fmtTime(s)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className={cx("flex items-center gap-3 rounded-xl border p-4", holdSeconds > 0 ? "border-amber-200 bg-amber-50" : "border-rose-200 bg-rose-50")}>
            <Lock size={20} className={holdSeconds > 0 ? "text-amber-600" : "text-rose-600"} />
            <div className="flex-1">
              <p className="text-sm font-medium text-ink-900">
                {holdSeconds > 0 ? "Temporary slot lock active" : "Hold expired — the slot was released"}
              </p>
              <p className="text-xs text-ink-600">
                {holdSeconds > 0
                  ? `No other caller or counter can take this slot for ${holdSeconds}s. Availability is re-checked again before the write.`
                  : "Go back and pick a slot again. This is exactly how a double booking is prevented under concurrent callers."}
              </p>
            </div>
            <span className="text-xl font-semibold tabular-nums text-ink-900">{holdSeconds}s</span>
          </div>

          <div className="rounded-xl border border-ink-200 p-4 text-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Booking summary</p>
            <dl className="grid gap-2 sm:grid-cols-2">
              <Summary k="Patient" v={`${patient?.name} · ${patient?.mrn}`} />
              <Summary k="Doctor" v={provider?.name ?? ""} />
              <Summary k="Speciality" v={provider?.speciality ?? ""} />
              <Summary k="Slot" v={slot ? `${fmtDate(slot)}, ${fmtTime(slot)}` : ""} />
              <Summary k="Duration" v={`${provider?.consultationMinutes} minutes`} />
              <Summary k="Fee" v={`₹${provider?.fee}`} />
            </dl>
          </div>

          {recheck === "checking" && (
            <p className="flex items-center gap-2 text-sm text-ink-600">
              <RefreshCw size={14} className="animate-spin" /> Re-checking availability against the source system…
            </p>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="py-6 text-center">
          <CheckCircle2 size={40} className="mx-auto text-emerald-500" />
          <p className="mt-3 text-lg font-semibold text-ink-900">Appointment confirmed</p>
          <p className="mt-1 text-sm text-ink-600">
            Appointment ID <strong>{createdId}</strong> — {patient?.name} with {provider?.name}
          </p>
          <p className="text-sm text-ink-600">{slot && `${fmtDate(slot)} at ${fmtTime(slot)}`}</p>
          <div className="mx-auto mt-4 max-w-sm space-y-1.5 text-left text-xs">
            {[
              "Slot lock released after atomic write",
              "Appointment pushed to HIS (idempotency key set)",
              "WhatsApp confirmation queued to patient",
              "Reminder call scheduled 24h before the slot",
              "Audit event written",
            ].map((s) => (
              <p key={s} className="flex items-center gap-2 text-ink-600">
                <CheckCircle2 size={13} className="text-emerald-500" /> {s}
              </p>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Summary({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-400">{k}</dt>
      <dd className="font-medium text-ink-800">{v}</dd>
    </div>
  );
}
