"use client";

import { useState } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, PageHeader, Select, StatTile, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { fmtDate, LANGUAGE_LABELS } from "@/lib/utils";
import { Building2, CalendarClock, Hospital, Plus, Stethoscope, Users } from "lucide-react";

type TabKey = "facilities" | "departments" | "doctors" | "calendars";

export default function AdminOrgPage() {
  const { can, org, notify, audit } = useStore();
  const d = useOrgData();
  const [tab, setTab] = useState<TabKey>("facilities");
  const [addOpen, setAddOpen] = useState(false);

  if (!can("org.configure")) return <Denied />;

  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <>
      <PageHeader
        title="Hospital & departments"
        subtitle={`${org?.name} — organisation hierarchy, clinical departments, doctors and booking rules`}
        actions={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setAddOpen(true)}>Add</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Facilities" value={d.facilities.length} icon={<Hospital size={15} />} tone="brand" />
        <StatTile label="Departments" value={d.departments.length} icon={<Building2 size={15} />} />
        <StatTile label="Doctors" value={d.providers.length} icon={<Stethoscope size={15} />} />
        <StatTile label="Staff accounts" value={d.users.length} icon={<Users size={15} />} />
        <StatTile label="Licensed beds" value={d.facilities.reduce((s, f) => s + f.beds, 0)} icon={<Hospital size={15} />} />
      </div>

      <Card className="mb-4">
        <CardHeader title="Organisation profile" icon={<Building2 size={16} />} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Legal name", org?.name ?? ""],
            ["Plan", (org?.plan ?? "").replace("_", " ")],
            ["Deployment", (org?.deployment ?? "").replace(/_/g, " ")],
            ["Contract start", org ? fmtDate(org.contractStart) : ""],
            ["City / state", `${org?.city}, ${org?.state}`],
            ["Time zone", org?.timezone ?? ""],
            ["Primary languages", (org?.primaryLanguages ?? []).map((l) => LANGUAGE_LABELS[l].split(" ")[0]).join(", ")],
            ["Integration status", (org?.integrationStatus ?? "").replace("_", " ")],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-ink-200 p-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400">{k}</p>
              <p className="mt-0.5 text-sm text-ink-800">{v}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card padded={false}>
        <div className="border-b border-ink-200 px-4 pt-2">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: "facilities", label: "Facilities", count: d.facilities.length },
              { key: "departments", label: "Departments", count: d.departments.length },
              { key: "doctors", label: "Doctors", count: d.providers.length },
              { key: "calendars", label: "Booking rules" },
            ]}
          />
        </div>

        {tab === "facilities" && (
          <Table>
            <thead><tr><Th>Facility</Th><Th>Address</Th><Th>Phone</Th><Th>Beds</Th><Th>Departments</Th><Th>Type</Th></tr></thead>
            <tbody>
              {d.facilities.map((f) => (
                <Tr key={f.id}>
                  <Td className="font-medium text-ink-900">{f.name}</Td>
                  <Td className="text-xs">{f.address}</Td>
                  <Td className="tabular-nums text-xs">{f.phone}</Td>
                  <Td className="tabular-nums">{f.beds}</Td>
                  <Td>{d.departments.filter((x) => x.facilityId === f.id).length}</Td>
                  <Td>{f.isPrimary ? <Badge tone="brand">primary</Badge> : <Badge>branch</Badge>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}

        {tab === "departments" && (
          <Table>
            <thead><tr><Th>Department</Th><Th>Code</Th><Th>Facility</Th><Th>Type</Th><Th>Doctors</Th><Th>Patients</Th><Th>Protocol</Th></tr></thead>
            <tbody>
              {d.departments.map((x) => (
                <Tr key={x.id}>
                  <Td className="font-medium text-ink-900">{x.name}</Td>
                  <Td className="font-mono text-xs">{x.code}</Td>
                  <Td className="text-xs">{d.facilities.find((f) => f.id === x.facilityId)?.name.split("—")[1]?.trim()}</Td>
                  <Td><Badge tone={x.type === "clinical" ? "brand" : "neutral"}>{x.type}</Badge></Td>
                  <Td>{d.providers.filter((p) => p.departmentId === x.id).length}</Td>
                  <Td>{d.patients.filter((p) => p.departmentId === x.id).length}</Td>
                  <Td className="text-xs">
                    {d.protocols.find((p) => p.departmentId === x.id)?.version ?? <span className="text-ink-400">—</span>}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}

        {tab === "doctors" && (
          <Table>
            <thead><tr><Th>Doctor</Th><Th>Speciality</Th><Th>Qualification</Th><Th>Slot</Th><Th>Fee</Th><Th>Working days</Th><Th>Hours</Th><Th>Patients</Th></tr></thead>
            <tbody>
              {d.providers.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-medium text-ink-900">{p.name}</Td>
                  <Td className="text-xs">{p.speciality}</Td>
                  <Td className="text-xs text-ink-500">{p.qualification}</Td>
                  <Td className="tabular-nums text-xs">{p.consultationMinutes} min</Td>
                  <Td className="tabular-nums text-xs">₹{p.fee}</Td>
                  <Td>
                    <div className="flex gap-0.5">
                      {DAYS.map((day, i) => (
                        <span key={day} className={p.workingDays.includes(i) ? "grid h-5 w-5 place-items-center rounded bg-brand-100 text-[9px] font-medium text-brand-700" : "grid h-5 w-5 place-items-center rounded bg-ink-100 text-[9px] text-ink-300"}>
                          {day[0]}
                        </span>
                      ))}
                    </div>
                  </Td>
                  <Td className="tabular-nums text-xs">{p.startHour}:00 – {p.endHour}:00</Td>
                  <Td>{d.patients.filter((x) => x.providerId === p.id).length}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}

        {tab === "calendars" && (
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {[
              ["Booking window", "Patients and the AI agent may book up to 30 days ahead, and no later than 2 hours before the slot."],
              ["Buffer between slots", "0 minutes for OPD; 15 minutes after any procedure slot."],
              ["Overbooking", "Not permitted. A temporary lock plus availability re-check makes double booking structurally impossible."],
              ["Cancellation rule", "Free cancellation up to 4 hours before; later cancellations create a task for the front desk."],
              ["No-show handling", "Marked after 20 minutes; triggers a re-engagement call in the patient's language."],
              ["Blocked dates", "Public holidays and doctor leave sync from the HIS and remove slots from AI availability automatically."],
              ["Emergency slots", "Two slots per doctor per day are reserved and not offered by the AI agent."],
              ["Follow-up priority", "Post-discharge review bookings get priority access to the reserved slots."],
              ["Language of confirmation", "Follows the patient's preferred language, not the staff member's."],
            ].map(([t, s]) => (
              <div key={t} className="rounded-lg border border-ink-200 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-900"><CalendarClock size={12} className="text-ink-400" />{t}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-600">{s}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add to the organisation"
        subtitle="Facilities, departments and doctors can also be synced from the HIS instead of entered here"
        footer={
          <>
            <Button onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => { audit("org.updated", "New entity added"); notify("Added — it is now available to the AI receptionist for booking"); setAddOpen(false); }}>
              Add
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="What are you adding?">
            <Select>
              <option>Department</option>
              <option>Doctor</option>
              <option>Facility / branch</option>
            </Select>
          </Field>
          <Field label="Name"><Input placeholder="e.g. Neurology" /></Field>
          <Field label="Facility">
            <Select>
              {d.facilities.map((f) => (<option key={f.id}>{f.name}</option>))}
            </Select>
          </Field>
          <Field label="Consultation duration" hint="Used to generate bookable slots for the AI receptionist">
            <Select><option>15 minutes</option><option>20 minutes</option><option>30 minutes</option></Select>
          </Field>
        </div>
      </Modal>
    </>
  );
}
