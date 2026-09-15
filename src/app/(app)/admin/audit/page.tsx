"use client";

import { useMemo, useState } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, Input, PageHeader, Select, StatTile, Table, Td, Th, Tr } from "@/components/ui";
import { downloadCsv, fmtDateTime, relative } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/rbac";
import { AlertTriangle, Download, Fingerprint, Lock, Search, ScrollText, ShieldCheck } from "lucide-react";

export default function AuditPage() {
  const { can, notify, audit } = useStore();
  const d = useOrgData();
  const [q, setQ] = useState("");
  const [severity, setSeverity] = useState("all");

  const rows = useMemo(
    () =>
      d.auditLogs.filter((l) => {
        if (severity !== "all" && l.severity !== severity) return false;
        if (q && !`${l.actor} ${l.action} ${l.target}`.toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      }),
    [d.auditLogs, q, severity],
  );

  if (!can("audit.view")) return <Denied />;

  return (
    <>
      <PageHeader
        title="Audit trail"
        subtitle="Tamper-evident record of every configuration change, clinical access and AI action"
        actions={
          <Button
            icon={<Download size={15} />}
            onClick={() => {
              audit("export.generated", `Audit export — ${rows.length} events`, "critical");
              downloadCsv("audit_trail.csv", rows.map((l) => ({
                Timestamp: fmtDateTime(l.at), Actor: l.actor, Role: l.actorRole, Action: l.action,
                Target: l.target, IP: l.ip, Severity: l.severity,
              })));
              notify("Audit export generated — the export itself is also logged");
            }}
          >
            Export for compliance
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Events recorded" value={d.auditLogs.length} icon={<ScrollText size={15} />} tone="brand" />
        <StatTile label="Critical events" value={d.auditLogs.filter((l) => l.severity === "critical").length} tone="red" icon={<AlertTriangle size={15} />} />
        <StatTile label="Clinical data access" value={d.auditLogs.filter((l) => l.action.includes("clinical") || l.action.includes("recording")).length} icon={<Fingerprint size={15} />} />
        <StatTile label="Retention" value="7 years" sub="write-once storage" icon={<Lock size={15} />} tone="green" />
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-ink-200 px-4 py-3">
          <div className="relative min-w-[240px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <Input className="pl-9" placeholder="Search actor, action or target…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-auto">
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </Select>
        </div>

        <Table>
          <thead>
            <tr><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Target</Th><Th>Source IP</Th><Th>Severity</Th></tr>
          </thead>
          <tbody>
            {rows.slice(0, 60).map((l) => (
              <Tr key={l.id}>
                <Td className="whitespace-nowrap text-xs">
                  <span className="block text-ink-900">{relative(l.at)}</span>
                  <span className="block text-[10px] text-ink-400">{fmtDateTime(l.at)}</span>
                </Td>
                <Td>
                  <span className="block text-sm text-ink-900">{l.actor}</span>
                  <span className="block text-[11px] text-ink-400">{ROLE_LABELS[l.actorRole]}</span>
                </Td>
                <Td><code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[11px] text-ink-700">{l.action}</code></Td>
                <Td className="max-w-[320px] text-xs">{l.target}</Td>
                <Td className="font-mono text-[11px] text-ink-500">{l.ip}</Td>
                <Td>
                  <Badge tone={l.severity === "critical" ? "red" : l.severity === "warning" ? "amber" : "neutral"}>{l.severity}</Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {rows.length > 60 && (
          <p className="border-t border-ink-100 px-4 py-2.5 text-xs text-ink-400">Showing the latest 60 of {rows.length} events.</p>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="What is recorded" icon={<ShieldCheck size={16} />} />
        <div className="grid gap-3 text-xs leading-relaxed text-ink-600 md:grid-cols-3">
          {[
            ["Configuration", "Agent publishes, protocol approvals, user and permission changes, telephony and integration edits — each with the actor, the before/after version and the time."],
            ["Clinical access", "Who opened which patient's clinical detail, who played which recording, and every governed export with its scope and row count."],
            ["AI actions", "Every call with its agent version, protocol version, model version, the tools it called, the data it retrieved, the actions it took and its structured outcome."],
          ].map(([t, s]) => (
            <div key={t} className="rounded-lg border border-ink-200 p-3">
              <p className="mb-1 text-xs font-semibold text-ink-900">{t}</p>
              <p>{s}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 rounded-lg bg-ink-50 p-3 text-[11px] leading-relaxed text-ink-500">
          Logs are append-only and hash-chained, shipped to the hospital&apos;s SIEM where one is configured. A super-admin
          opening a hospital workspace is itself a critical audit event with a recorded justification — the platform
          operator is not above the audit trail.
        </p>
      </Card>
    </>
  );
}
