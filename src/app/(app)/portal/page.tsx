"use client";

import { useState } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, Modal, PageHeader, Select, Toggle } from "@/components/ui";
import { cx, fmtDate, fmtDateTime, fmtTime, inr, LANGUAGE_LABELS, relative } from "@/lib/utils";
import type { LanguageCode } from "@/lib/types";
import {
  CalendarCheck, CalendarPlus, CheckCircle2, FileText, FlaskConical, HeartPulse, IndianRupee, MessageSquare,
  Phone, Pill, ShieldCheck,
} from "lucide-react";

export default function PortalPage() {
  const { can, currentUser, notify, updatePatient, bookAppointment } = useStore();
  const d = useOrgData();
  const [bookOpen, setBookOpen] = useState(false);
  const [slot, setSlot] = useState("");

  // the demo patient user maps onto the seeded patient of the same name
  const patient = d.patients.find((p) => p.name === currentUser?.name) ?? d.patients[0];

  if (!can("portal.self")) return <Denied />;
  if (!patient) return <EmptyState title="No patient record linked to this account" />;

  const provider = d.providers.find((p) => p.id === patient.providerId);
  const appts = d.appointments.filter((a) => a.patientId === patient.id).sort((a, b) => (a.start < b.start ? 1 : -1));
  const upcoming = appts.filter((a) => new Date(a.start) > new Date() && a.status !== "cancelled");
  const labs = d.labOrders.filter((l) => l.patientId === patient.id && (l.status === "resulted" || l.status === "verified"));
  const invoices = d.invoices.filter((i) => i.patientId === patient.id);
  const calls = d.calls.filter((c) => c.patientId === patient.id);
  const outstanding = invoices.reduce((s, i) => s + (i.lines.reduce((x, l) => x + l.qty * l.rate, 0) - i.discount - i.paid), 0);

  const slots = (() => {
    const out: string[] = [];
    if (!provider) return out;
    for (let day = 1; day <= 5; day++) {
      const b = new Date();
      b.setDate(b.getDate() + day);
      for (const h of [10, 11, 15, 17]) {
        const t = new Date(b);
        t.setHours(h, 15, 0, 0);
        out.push(t.toISOString());
      }
    }
    return out.slice(0, 12);
  })();

  return (
    <>
      <PageHeader
        title={`Namaskar, ${patient.name.split(" ")[0]}`}
        subtitle={`${patient.mrn} · under the care of ${provider?.name}`}
        actions={<Button variant="primary" icon={<CalendarPlus size={15} />} onClick={() => setBookOpen(true)}>Book an appointment</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Your next appointment" icon={<CalendarCheck size={16} />} />
          {upcoming.length === 0 ? (
            <EmptyState title="No upcoming appointment" hint="Book one whenever you need — it takes under a minute." />
          ) : (
            <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4">
              <p className="text-lg font-semibold text-ink-900">{fmtDate(upcoming[0].start)} at {fmtTime(upcoming[0].start)}</p>
              <p className="mt-1 text-sm text-ink-700">
                {d.providers.find((p) => p.id === upcoming[0].providerId)?.name} ·{" "}
                {d.departments.find((x) => x.id === upcoming[0].departmentId)?.name}
              </p>
              <p className="mt-1 text-xs text-ink-500">
                {d.facilities.find((f) => f.id === upcoming[0].facilityId)?.address}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => notify("Reschedule request sent — the hospital will confirm shortly")}>Reschedule</Button>
                <Button size="sm" variant="ghost" onClick={() => notify("Cancellation request sent")}>Cancel</Button>
                <Button size="sm" icon={<MessageSquare size={13} />} onClick={() => notify("Directions sent to your WhatsApp")}>Get directions</Button>
              </div>
            </div>
          )}

          <div className="mt-4">
            <p className="mb-2 text-sm font-semibold text-ink-900">Past visits</p>
            <div className="space-y-1.5">
              {appts.filter((a) => new Date(a.start) <= new Date()).slice(0, 5).map((a) => (
                <div key={a.id} className="flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-xs">
                  <span className="font-medium text-ink-900">{fmtDate(a.start)}</span>
                  <span className="text-ink-600">{d.providers.find((p) => p.id === a.providerId)?.name}</span>
                  <span className="text-ink-400">{a.reason}</span>
                  <Badge tone={a.status === "completed" ? "green" : "neutral"} className="ml-auto">{a.status.replace("_", " ")}</Badge>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Your medicines" icon={<Pill size={16} />} />
          <div className="space-y-2">
            {patient.medications.map((m) => (
              <div key={m.name} className="rounded-lg border border-ink-200 p-2.5">
                <p className="text-sm font-medium text-ink-900">{m.name}</p>
                <p className="text-xs text-ink-600">{m.dose} · {m.frequency}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 rounded-lg bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
            Never change a dose on your own. If something feels wrong, use &ldquo;Ask for a callback&rdquo; below and a
            clinician will speak to you.
          </p>
          <Button className="mt-3 w-full" icon={<Phone size={14} />} onClick={() => notify("Callback requested — the care team will call you today")}>
            Ask for a callback
          </Button>
        </Card>

        <Card>
          <CardHeader title="Reports" icon={<FlaskConical size={16} />} />
          {labs.length === 0 ? (
            <EmptyState title="No reports yet" />
          ) : (
            <div className="space-y-2">
              {labs.slice(0, 5).map((l) => (
                <div key={l.id} className="rounded-lg border border-ink-200 p-2.5">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-ink-900">{l.panel}</p>
                    <Badge tone={l.status === "verified" ? "green" : "amber"} className="ml-auto">{l.status}</Badge>
                  </div>
                  <p className="text-[11px] text-ink-400">{l.resultedAt ? relative(l.resultedAt) : ""}</p>
                  <Button size="sm" className="mt-2 w-full" icon={<FileText size={13} />} onClick={() => notify("Secure report link sent to your WhatsApp (valid 48 hours)")}>
                    View report
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Bills" icon={<IndianRupee size={16} />} />
          {outstanding > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs text-amber-800">Outstanding</p>
              <p className="text-2xl font-semibold text-ink-900">{inr(outstanding)}</p>
              <Button variant="primary" className="mt-2 w-full" onClick={() => notify("Secure payment link opened")}>Pay now</Button>
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <CheckCircle2 size={18} className="text-emerald-600" />
              <p className="mt-1 text-sm font-medium text-ink-900">All bills settled</p>
            </div>
          )}
          <div className="mt-3 space-y-1.5">
            {invoices.slice(0, 4).map((i) => (
              <div key={i.id} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-ink-600">{i.number}</span>
                <span className="ml-auto tabular-nums text-ink-900">{inr(i.lines.reduce((s, l) => s + l.qty * l.rate, 0) - i.discount)}</span>
                <Badge tone={i.status === "paid" ? "green" : "amber"}>{i.status.replace("_", " ")}</Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Calls from the hospital" icon={<HeartPulse size={16} />} />
          {calls.length === 0 ? (
            <EmptyState title="No calls yet" />
          ) : (
            <div className="space-y-2">
              {calls.slice(0, 4).map((c) => (
                <div key={c.id} className="rounded-lg border border-ink-200 p-2.5 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge tone={c.agentType === "care" ? "purple" : "blue"}>{c.agentType === "care" ? "follow-up" : "front desk"}</Badge>
                    <span className="ml-auto text-[10px] text-ink-400">{relative(c.startedAt)}</span>
                  </div>
                  <p className="mt-1 text-ink-700">{c.outcome}</p>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
            The hospital&apos;s assistant may call you in {LANGUAGE_LABELS[patient.language]} to check how you are. You can
            ask to speak to a person at any point in the call.
          </p>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Your privacy choices" subtitle="You control how the hospital contacts you" icon={<ShieldCheck size={16} />} />
          <div className="grid gap-x-8 md:grid-cols-2">
            <Toggle
              label="Follow-up calls about my treatment"
              description="Post-discharge and recovery check-ins from the hospital's assistant"
              checked={patient.consent.clinicalCalls}
              onChange={(v) => { updatePatient(patient.id, { consent: { ...patient.consent, clinicalCalls: v, updatedAt: new Date().toISOString() } }); notify(v ? "Thank you — follow-up calls are on" : "Follow-up calls turned off. The hospital will still reach you for urgent matters."); }}
            />
            <Toggle
              label="WhatsApp messages"
              description="Appointment confirmations, reports and reminders"
              checked={patient.consent.whatsapp}
              onChange={(v) => { updatePatient(patient.id, { consent: { ...patient.consent, whatsapp: v, updatedAt: new Date().toISOString() } }); notify("Preference saved"); }}
            />
            <Toggle
              label="Recording of my calls"
              description="Used for quality and safety review, kept per the hospital's retention policy"
              checked={patient.consent.recording}
              onChange={(v) => { updatePatient(patient.id, { consent: { ...patient.consent, recording: v, updatedAt: new Date().toISOString() } }); notify("Preference saved"); }}
            />
            <Toggle
              label="Health camps and offers"
              description="Entirely separate from your treatment communication"
              checked={patient.consent.marketing}
              onChange={(v) => { updatePatient(patient.id, { consent: { ...patient.consent, marketing: v, updatedAt: new Date().toISOString() } }); notify("Preference saved"); }}
            />
          </div>
          <p className="mt-3 text-[11px] text-ink-400">
            Consent version {patient.consent.version} · last updated {fmtDateTime(patient.consent.updatedAt)}
          </p>
        </Card>
      </div>

      <Modal
        open={bookOpen}
        onClose={() => setBookOpen(false)}
        title="Book an appointment"
        subtitle={provider ? `${provider.name} · ${provider.speciality}` : ""}
        footer={
          <>
            <Button onClick={() => setBookOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!slot}
              onClick={() => {
                bookAppointment({
                  orgId: patient.orgId, facilityId: patient.facilityId, patientId: patient.id,
                  providerId: patient.providerId, departmentId: patient.departmentId, start: slot,
                  durationMinutes: provider?.consultationMinutes ?? 15, status: "booked",
                  source: "patient_portal", reason: "Patient-requested review",
                });
                notify("Appointment requested — you will get a WhatsApp confirmation shortly");
                setBookOpen(false);
                setSlot("");
              }}
            >
              Confirm
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-ink-600">Pick a time that works for you.</p>
        <div className="grid grid-cols-3 gap-1.5">
          {slots.map((s) => (
            <button
              key={s}
              onClick={() => setSlot(s)}
              className={cx("rounded-lg border px-2 py-2 text-[11px]", slot === s ? "border-brand-500 bg-brand-50 font-medium text-brand-700" : "border-ink-200 hover:bg-ink-50")}
            >
              <span className="block">{new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
              <span className="block font-medium">{fmtTime(s)}</span>
            </button>
          ))}
        </div>
        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-ink-600">Preferred language for reminders</span>
          <Select
            value={patient.language}
            onChange={(e) => { updatePatient(patient.id, { language: e.target.value as LanguageCode }); notify("Language preference saved"); }}
          >
            {(["mr", "hi", "en", "hinglish"] as LanguageCode[]).map((l) => (
              <option key={l} value={l}>{LANGUAGE_LABELS[l]}</option>
            ))}
          </Select>
        </label>
      </Modal>
    </>
  );
}
