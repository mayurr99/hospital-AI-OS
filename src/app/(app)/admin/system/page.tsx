"use client";

/**
 * System status.
 *
 * Whoever runs this for a hospital needs one screen that answers "is it
 * healthy, and when did we last take a backup" without opening a terminal.
 * Everything here comes from `/api/health`, which is also what an uptime
 * monitor polls — so what is on this screen and what wakes someone at night are
 * the same set of facts, rather than two views that can disagree.
 */

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { cx, relative } from "@/lib/utils";
import { Activity, AlertTriangle, CheckCircle2, DatabaseBackup, HardDrive, RefreshCw, ShieldCheck } from "lucide-react";

type State = "ok" | "degraded" | "failing";

interface Check { name: string; state: State; detail: string; ms: number }
interface Report { status: State; checks: Check[]; uptimeSeconds: number; at: string }

const TONE: Record<State, "green" | "amber" | "red"> = { ok: "green", degraded: "amber", failing: "red" };
const LABEL: Record<string, string> = {
  "database.read": "Database — reading",
  "database.write": "Database — writing",
  "database.size": "Database size",
  disk: "Disk space",
  backup: "Backups",
};
const WHY: Record<string, string> = {
  "database.read": "If this fails nothing in the hospital works.",
  "database.write":
    "The quiet one. When the disk fills, reads keep working and writes stop — a nurse records vitals that never save.",
  "database.size": "Watched so growth is noticed before the disk is the thing that notices it.",
  disk: "Below about 200 MB free, writes start failing.",
  backup: "A backup nobody has restored is a hope. Run npm run backup on a schedule, and keep a copy off this machine.",
};

function duration(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

interface Posture {
  mfa: {
    staff: number; required: number; enrolled: number; pending: number;
    requireAllStaff: boolean; floorDisabled: boolean; demoDataPresent: boolean;
  };
  encryptionAtRest: { configured: boolean; fingerprint: string; detail: string; covers: string };
}

export default function SystemPage() {
  const { can } = useStore();
  const [report, setReport] = useState<Report | null>(null);
  const [posture, setPosture] = useState<Posture | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      /* A failing system answers 503; that is the answer, not an error. */
      const res = await fetch("/api/health", { cache: "no-store" });
      setReport((await res.json()) as Report);
      setCheckedAt(new Date().toISOString());
      /* Separate call: /api/health is unauthenticated by design and must not
         say anything about this hospital, so the posture comes from a route
         that requires an administrator. */
      const sec = await fetch("/api/admin/security", { cache: "no-store" });
      setPosture(sec.ok ? ((await sec.json()) as Posture) : null);
    } catch {
      setReport(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (!can("org.configure")) return <Denied />;

  const status = report?.status ?? "failing";

  return (
    <>
      <PageHeader
        title="System status"
        subtitle="What an uptime monitor sees, on one screen"
        actions={
          <Button icon={<RefreshCw size={15} className={cx(busy && "animate-spin")} />} onClick={() => void load()} disabled={busy}>
            Check now
          </Button>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <span
            className={cx(
              "grid h-12 w-12 shrink-0 place-items-center rounded-xl",
              status === "ok" ? "bg-emerald-50 text-emerald-700" : status === "degraded" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700",
            )}
          >
            {status === "ok" ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
          </span>
          <div className="min-w-[220px] flex-1">
            <p className="text-lg font-semibold text-ink-900">
              {status === "ok" ? "Serving normally" : status === "degraded" ? "Serving, but something needs attention" : "Not serving correctly"}
            </p>
            <p className="mt-0.5 text-xs text-ink-500">
              {report ? `Up ${duration(report.uptimeSeconds)}` : "Could not reach the health endpoint"}
              {checkedAt ? ` · checked ${relative(checkedAt)}` : ""}
            </p>
          </div>
          <Badge tone={TONE[status]}>{status}</Badge>
        </div>
      </Card>

      <Card padded={false} className="mb-4">
        <div className="px-5 pt-5">
          <CardHeader title="Checks" subtitle="Each one is a way the hospital stops working" icon={<Activity size={16} />} />
        </div>
        <Table>
          <thead>
            <tr><Th>Check</Th><Th>State</Th><Th>Detail</Th><Th>Why it is here</Th></tr>
          </thead>
          <tbody>
            {(report?.checks ?? []).map((c) => (
              <Tr key={c.name}>
                <Td className="font-medium text-ink-900">{LABEL[c.name] ?? c.name}</Td>
                <Td><Badge tone={TONE[c.state]}>{c.state}</Badge></Td>
                <Td className="text-xs">{c.detail}{c.ms ? ` · ${c.ms}ms` : ""}</Td>
                <Td className="max-w-[360px] text-[11px] leading-relaxed text-ink-500">{WHY[c.name] ?? ""}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {!report && <p className="px-5 py-8 text-center text-sm text-ink-500">No response from the health endpoint.</p>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Backups" icon={<DatabaseBackup size={16} />} />
          <p className="text-xs leading-relaxed text-ink-600">
            Take one with <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[11px]">npm run backup</code>.
            It writes a consistent snapshot while the app keeps serving, checks its own integrity, and keeps the last
            seven generations.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-600">
            Restore with <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[11px]">npm run restore &lt;dir&gt;</code>.
            It refuses to run while the app is serving, keeps the database it replaces, and verifies the result.
          </p>
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
            <ShieldCheck size={11} className="mr-1 inline" />
            A backup on this machine is not a backup. Copy each generation somewhere else, and rehearse a restore
            before you need one — <code className="font-mono">npm run test:disaster</code> does exactly that against a
            scratch database.
          </p>
        </Card>

        {/*
          Configured versus in force. An administrator signing a compliance
          form needs the second number, and needs to see the exemptions that
          shrink it — which is exactly what the old "MFA enabled" switch hid.
        */}
        <Card>
          <CardHeader title="Sign-in and encryption" icon={<ShieldCheck size={16} />} />
          {!posture ? (
            <div className="h-24 animate-pulse rounded-xl bg-ink-100" />
          ) : (
            <ul className="space-y-2 text-xs leading-relaxed text-ink-600">
              <li>
                <b className="text-ink-900">Two-step sign-in.</b>{" "}
                {posture.mfa.enrolled} of {posture.mfa.staff} active staff have an authenticator set up;{" "}
                {posture.mfa.required} are required to.
                {posture.mfa.pending > 0 && (
                  <span className="font-medium text-amber-700">
                    {" "}{posture.mfa.pending} required but not yet set up — they will be made to enrol at their next
                    sign-in, and cannot reach a patient record until they do.
                  </span>
                )}
              </li>
              {posture.mfa.floorDisabled && (
                <li className="text-amber-700">
                  <b>MFA_FLOOR=off is set on this server.</b> The automatic requirement for anyone who can open a
                  patient record is switched off; only accounts an administrator has individually marked are asked
                  for a second factor.
                </li>
              )}
              {posture.mfa.demoDataPresent && (
                <li className="text-amber-700">
                  <b>This database contains demo hospitals.</b> Their accounts share a password printed on the
                  sign-in screen and are exempt from two-step sign-in, as is the platform account. A production
                  deployment runs with <code className="font-mono">SEED_DEMO=0</code> and has none.
                </li>
              )}
              <li>
                <b className="text-ink-900">Encryption at rest.</b>{" "}
                {posture.encryptionAtRest.configured
                  ? `On (key ${posture.encryptionAtRest.fingerprint}). `
                  : "Off — no STORAGE_ENCRYPTION_KEY is set, so recordings and exports are written in plain text. "}
                {posture.encryptionAtRest.covers}
              </li>
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="What this does not cover" icon={<HardDrive size={16} />} />
          <ul className="space-y-2 text-xs leading-relaxed text-ink-600">
            <li>
              <b className="text-ink-900">One machine.</b> If this process stops, the hospital has no system — not a
              degraded one. There is no failover yet.
            </li>
            <li>
              <b className="text-ink-900">No alerting.</b> This screen tells you when you look at it. Point an uptime
              monitor at <code className="font-mono">/api/health</code>; it answers 503 when something is failing.
            </li>
            <li>
              <b className="text-ink-900">No error tracking.</b> Server errors reach the terminal and nowhere else.
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}
