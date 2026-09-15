"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useOrgData, useStore } from "@/lib/store";
import { useSticky } from "@/lib/sticky";
import { Denied } from "@/components/AppShell";
import { Avatar, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { api } from "@/lib/http";
import { downloadCsv, fmtDate, LANGUAGE_SHORT, relative, RISK_STYLES, cx } from "@/lib/utils";
import { BedDouble, Download, FileSpreadsheet, Filter, Search, ShieldOff, UserPlus, Users } from "lucide-react";

type TabKey = "all" | "followup" | "ipd" | "opd" | "discharged";

/** The legacy patient row shape the table renders. */
type Row = ReturnType<typeof useOrgData>["patients"][number];

export default function PatientsPage() {
  const { can, currentUser, audit, notify, badges, dataReady } = useStore();
  const router = useRouter();
  const [registerOpen, setRegisterOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reg, setReg] = useState<Record<string, string>>({});
  const d = useOrgData();
  /* Filters survive opening a patient and coming back. */
  const [tab, setTab] = useSticky<TabKey>("patients.tab", "all");
  const [q, setQ] = useSticky("patients.q", "");
  const [dept, setDept] = useSticky("patients.dept", "all");
  const [risk, setRisk] = useSticky("patients.risk", "all");

  const mine = currentUser?.role === "doctor";

  /*
   * Search runs on the server across the whole register.
   *
   * The workspace keeps the 300 most recently updated patients in memory for
   * instant browsing, which is what staff want when they open the screen. But a
   * hospital with 8,000 patients must not have a search box that quietly only
   * looks at 300 of them — so as soon as the user types, the query goes to the
   * database and the count shown is the true count.
   */
  const searching = q.trim().length >= 2;
  const [remote, setRemote] = useState<{ items: Row[]; total: number } | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!searching) {
      setRemote(null);
      setSearchBusy(false);
      return;
    }
    const mine_ = ++seq.current;
    setSearchBusy(true);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: q.trim(), limit: "100" });
        if (dept !== "all") params.set("departmentId", dept);
        if (risk !== "all") params.set("risk", risk);
        if (mine) params.set("mine", "1");
        const res = await api<{ total: number; items: Record<string, unknown>[] }>(`/api/patients?${params}`);
        if (seq.current !== mine_) return; // a newer keystroke already won
        setRemote({
          total: res.total,
          items: res.items.map((p) => {
            const adm = p.currentAdmission as { admittedAt?: string } | null;
            const consent = (p.consent ?? {}) as Record<string, boolean>;
            return {
              id: p.id, orgId: p.orgId, facilityId: p.facilityId ?? "",
              mrn: p.uhid, name: p.fullName, age: p.age ?? 0,
              gender: p.gender === "male" ? "M" : p.gender === "female" ? "F" : "O",
              phone: p.mobile ?? "", language: p.preferredLanguage ?? "en",
              departmentId: p.departmentId ?? "", providerId: p.providerId ?? "",
              carePathway: p.carePathway ?? "", diagnosis: "",
              allergies: [], medications: [],
              consent, status: adm ? "ipd" : "opd",
              admittedAt: adm?.admittedAt, dischargedAt: undefined,
              lastContact: p.lastContact ?? null,
              risk: ["green", "amber", "red"].includes(String(p.risk)) ? p.risk : "green",
              abhaId: p.abhaId ?? undefined, uhid: p.uhid, dateOfBirth: p.dateOfBirth ?? null,
            };
          }) as unknown as Row[],
        });
      } catch {
        if (seq.current === mine_) setRemote({ items: [], total: 0 });
      } finally {
        if (seq.current === mine_) setSearchBusy(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q, dept, risk, mine, searching]);

  const rows = useMemo(() => {
    const source = searching ? remote?.items ?? [] : d.patients;
    return source.filter((p) => {
      if (mine && p.providerId !== currentUser?.providerId) return false;
      if (tab !== "all" && p.status !== tab) return false;
      /* When searching, the server has already applied these two. */
      if (!searching && dept !== "all" && p.departmentId !== dept) return false;
      if (!searching && risk !== "all" && p.risk !== risk) return false;
      return true;
    });
  }, [d.patients, remote, searching, tab, dept, risk, mine, currentUser]);

  if (!can("patients.view")) return <Denied />;

  /* Counts describe what is loaded, except the total, which is the real figure. */
  const counts = {
    all: searching ? rows.length : badges?.patients ?? d.patients.length,
    followup: d.patients.filter((p) => p.status === "followup").length,
    ipd: d.patients.filter((p) => p.status === "ipd").length,
    opd: d.patients.filter((p) => p.status === "opd").length,
    discharged: d.patients.filter((p) => p.status === "discharged").length,
  };

  function exportCsv() {
    const clinical = can("patients.clinical.view");
    audit("export.generated", `Patient list — ${rows.length} rows (${clinical ? "clinical" : "administrative"} scope)`, "warning");
    downloadCsv(
      "patients_export.csv",
      rows.map((p) => ({
        MRN: p.mrn,
        Name: p.name,
        Age: p.age,
        Gender: p.gender,
        Phone: can("patients.clinical.view") ? p.phone : "••••••" + p.phone.slice(-4),
        Language: p.language,
        Department: d.departments.find((x) => x.id === p.departmentId)?.name ?? "",
        Doctor: d.providers.find((x) => x.id === p.providerId)?.name ?? "",
        Diagnosis: clinical ? p.diagnosis : "[restricted]",
        CarePathway: clinical ? p.carePathway : "[restricted]",
        Status: p.status,
        Risk: p.risk,
        ConsentClinicalCalls: p.consent.clinicalCalls ? "yes" : "no",
        LastContact: p.lastContact ? fmtDate(p.lastContact) : "never",
      })),
    );
    notify(`Exported ${rows.length} rows — download logged to audit trail`);
  }

  return (
    <>
      <PageHeader
        title="Patients"
        subtitle={mine ? "Patients under your care" : `${(badges?.patients ?? d.patients.length).toLocaleString("en-IN")} patients across ${d.facilities.length} facilit${d.facilities.length > 1 ? "ies" : "y"}`}
        actions={
          <>
            {can("data.import") && (
              <Link href="/patients/import">
                <Button icon={<FileSpreadsheet size={15} />}>Import patients</Button>
              </Link>
            )}
            {can("data.export") && (
              <Button icon={<Download size={15} />} onClick={exportCsv}>Export (role-filtered)</Button>
            )}
            {can("patients.register") && (
              <Button variant="primary" icon={<UserPlus size={15} />} onClick={() => { setReg({}); setRegisterOpen(true); }}>
                Register patient
              </Button>
            )}
          </>
        }
      />

      <Card padded={false}>
        <div className="border-b border-ink-200 px-4 pt-2">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: "all", label: "All", count: counts.all },
              { key: "followup", label: "In follow-up", count: counts.followup },
              { key: "ipd", label: "Admitted", count: counts.ipd },
              { key: "opd", label: "OPD", count: counts.opd },
              { key: "discharged", label: "Discharged", count: counts.discharged },
            ]}
          />
        </div>

        {/* One row on a desk monitor, stacked on a phone — the three controls
            were previously each taking a full-width line at every size. */}
        <div className="grid items-center gap-2 border-b border-ink-200 px-4 py-3 sm:grid-cols-[minmax(220px,1fr)_auto_auto_auto]">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <Input className="pl-9" placeholder="Name, MRN or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select value={dept} onChange={(e) => setDept(e.target.value)} className="sm:w-[13rem]">
            <option value="all">All departments</option>
            {d.departments.filter((x) => x.type === "clinical").map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </Select>
          <Select value={risk} onChange={(e) => setRisk(e.target.value)} className="sm:w-[11rem]">
            <option value="all">Any risk state</option>
            <option value="red">Red — escalation</option>
            <option value="amber">Amber — review</option>
            <option value="green">Green — routine</option>
          </Select>
          <span className="flex items-center gap-1 text-xs text-ink-400">
            <Filter size={12} />
            {searchBusy ? "searching…" : searching ? `${remote?.total ?? 0} found` : `${rows.length} shown`}
          </span>
        </div>

        <Table>
          <thead>
            <tr>
              <Th>Patient</Th>
              <Th>Department / doctor</Th>
              <Th>Current location</Th>
              <Th>Lang</Th>
              <Th>Risk</Th>
              <Th>Consent</Th>
              <Th>Last contact</Th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 60).map((p) => (
              <Tr key={p.id}>
                <Td>
                  <Link href={`/patients/${p.id}`} className="flex items-center gap-2.5">
                    <Avatar name={p.name} size={32} hue={p.gender === "F" ? 320 : 205} />
                    <span>
                      <span className="block text-sm font-medium text-ink-900 hover:text-brand-700">{p.name}</span>
                      <span className="block text-[11px] text-ink-400">
                        {p.mrn} · {p.age}{p.gender}
                        {p.abhaId && " · ABHA linked"}
                      </span>
                    </span>
                  </Link>
                </Td>
                <Td className="text-xs">
                  <span className="block text-ink-700">{d.departments.find((x) => x.id === p.departmentId)?.name}</span>
                  <span className="block text-ink-400">{d.providers.find((x) => x.id === p.providerId)?.name}</span>
                </Td>
                <Td className="max-w-[240px] text-xs">
                  {p.status === "ipd" ? (
                    <span className="inline-flex items-center gap-1 font-medium text-brand-700">
                      <BedDouble size={12} /> Admitted{p.admittedAt ? ` · ${relative(p.admittedAt)}` : ""}
                    </span>
                  ) : can("patients.clinical.view") ? (
                    <span className="block truncate text-ink-500">{p.carePathway || "Outpatient"}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-ink-400">
                      <ShieldOff size={12} /> Restricted for your role
                    </span>
                  )}
                </Td>
                <Td><Badge tone="neutral">{LANGUAGE_SHORT[p.language]}</Badge></Td>
                <Td>
                  {(() => {
                    // Defensive: never let an unexpected risk value take the page down.
                    const style = RISK_STYLES[p.risk] ?? RISK_STYLES.green;
                    return (
                      <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", style.chip)}>
                        <span className={cx("h-1.5 w-1.5 rounded-full", style.dot)} />
                        {style.label}
                      </span>
                    );
                  })()}
                </Td>
                <Td>
                  <div className="flex gap-1">
                    <Badge tone={p.consent.clinicalCalls ? "green" : "red"}>calls</Badge>
                    {p.consent.whatsapp && <Badge tone="blue">WA</Badge>}
                  </div>
                </Td>
                <Td className="text-xs text-ink-500">{p.lastContact ? relative(p.lastContact) : "never"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {rows.length === 0 && (
          <div className="px-4 py-12 text-center">
            <Users size={24} className="mx-auto mb-2 text-ink-300" />
            <p className="text-sm text-ink-500">
              {searchBusy ? "Searching the patient register…"
                : !dataReady ? "Loading patients…"
                : searching ? `No patient matches “${q.trim()}”.`
                : "No patients match these filters."}
            </p>
            {searching && !searchBusy && (
              <p className="mt-1 text-xs text-ink-400">Searched every patient in this hospital by name, UHID and phone.</p>
            )}
          </div>
        )}
        {/*
          Says plainly what the list is showing against what exists, so nobody
          concludes a patient is missing when they are simply not in the cached
          working set.
        */}
        {rows.length > 0 && (
          <p className="border-t border-ink-100 px-4 py-2.5 text-xs text-ink-400">
            {searching ? (
              <>Showing {Math.min(rows.length, 60)} of {remote?.total ?? rows.length} matching patients across the whole register.</>
            ) : (
              <>
                Showing {Math.min(rows.length, 60)} of the {rows.length} most recently updated
                {badges?.patients ? ` · ${badges.patients.toLocaleString("en-IN")} patients registered in total` : ""}
                {" — type a name, UHID or phone number to search all of them."}
              </>
            )}
          </p>
        )}
      </Card>

      <Modal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        title="Register a patient"
        subtitle="This creates the permanent patient identity. Admission is a separate step."
        wide
        footer={
          <>
            <Button onClick={() => setRegisterOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy || !reg.firstName}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await api<{ duplicate?: boolean; message?: string; patient?: { id: string; uhid: string } }>(
                    "/api/patients",
                    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reg) },
                  );
                  if (res.duplicate) {
                    notify(res.message ?? "A matching patient already exists");
                  } else if (res.patient) {
                    notify(`Registered — UHID ${res.patient.uhid}`);
                    setRegisterOpen(false);
                    router.push(`/patients/${res.patient.id}`);
                  }
                } catch (e) {
                  notify(e instanceof Error ? e.message : "Could not register this patient");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Registering…" : "Register"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ["firstName", "First name"], ["middleName", "Middle name"], ["lastName", "Last name"],
            ["dateOfBirth", "Date of birth"], ["mobile", "Mobile"], ["altMobile", "Alternate mobile"],
            ["email", "Email"], ["addressLine", "Address"], ["village", "Village"], ["taluka", "Taluka"],
            ["district", "District"], ["state", "State"], ["pin", "PIN"],
            ["emergencyName", "Emergency contact"], ["emergencyRelation", "Relation"], ["emergencyMobile", "Emergency mobile"],
            ["abhaId", "ABHA id"], ["insuranceProvider", "Insurer"], ["insuranceNumber", "Policy number"],
            ["externalId", "Existing hospital id"],
          ] as [string, string][]).map(([k, label]) => (
            <Field key={k} label={label} hint={k === "dateOfBirth" ? "Age is derived from this" : undefined}>
              <Input
                type={k === "dateOfBirth" ? "date" : "text"}
                value={reg[k] ?? ""}
                onChange={(e) => setReg({ ...reg, [k]: e.target.value })}
              />
            </Field>
          ))}
          <Field label="Gender">
            <Select value={reg.gender ?? "unknown"} onChange={(e) => setReg({ ...reg, gender: e.target.value })}>
              {["unknown", "male", "female", "other"].map((g) => <option key={g} value={g}>{g}</option>)}
            </Select>
          </Field>
          <Field label="Blood group">
            <Select value={reg.bloodGroup ?? ""} onChange={(e) => setReg({ ...reg, bloodGroup: e.target.value })}>
              <option value="">Unknown</option>
              {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => <option key={b} value={b}>{b}</option>)}
            </Select>
          </Field>
          <Field label="Preferred language">
            <Select value={reg.preferredLanguage ?? "en"} onChange={(e) => setReg({ ...reg, preferredLanguage: e.target.value })}>
              {["en", "hi", "mr", "hinglish"].map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Department">
            <Select value={reg.departmentId ?? ""} onChange={(e) => setReg({ ...reg, departmentId: e.target.value })}>
              <option value="">—</option>
              {d.departments.filter((x) => x.type === "clinical").map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
    </>
  );
}
