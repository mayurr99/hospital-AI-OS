"use client";

/**
 * Settings → Security. Reachable by every signed-in user, not only
 * administrators: the person who needs to set up an authenticator is the nurse
 * on the ward, and a screen only an admin can open would mean the admin doing
 * it for them, which defeats the point of a factor only that person holds.
 */

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, PageHeader } from "@/components/ui";
import { BackupCodes, MfaEnrolStep } from "@/components/MfaSteps";
import { api } from "@/lib/http";
import { fmtDate } from "@/lib/utils";
import { AlertTriangle, KeyRound, ShieldAlert, ShieldCheck, Smartphone } from "lucide-react";

interface Status {
  required: boolean;
  enrolled: boolean;
  confirmedAt: string | null;
  backupCodesRemaining: number;
}

export default function SecurityPage() {
  const { currentUser, notify } = useStore();
  const [status, setStatus] = useState<Status | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [dialog, setDialog] = useState<null | "disable" | "regenerate">(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ status: Status }>("/api/auth/mfa")
      .then((d) => setStatus(d.status))
      .catch(() => setStatus(null));
  }, []);
  useEffect(load, [load]);

  function closeDialog() {
    setDialog(null);
    setPassword("");
    setCode("");
    setError(null);
  }

  async function submitDialog() {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ backupCodes?: string[] }>("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: dialog === "disable" ? "disable" : "regenerate-backup-codes",
          password,
          code,
        }),
      });
      closeDialog();
      load();
      if (data.backupCodes) setCodes(data.backupCodes);
      else notify("Two-step sign-in turned off for your account");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work");
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  if (codes) {
    return (
      <>
        <PageHeader title="Security" subtitle="Two-step sign-in for your own account" />
        <Card className="max-w-lg">
          <BackupCodes codes={codes} doneLabel="Done" onDone={() => { setCodes(null); load(); }} />
        </Card>
      </>
    );
  }

  if (enrolling) {
    return (
      <>
        <PageHeader title="Security" subtitle="Two-step sign-in for your own account" />
        <Card className="max-w-lg">
          <MfaEnrolStep onComplete={(r) => { setEnrolling(false); setCodes(r.backupCodes); }} />
          <button
            onClick={() => setEnrolling(false)}
            className="mt-3 w-full text-center text-xs text-ink-500 hover:text-ink-800"
          >
            Cancel
          </button>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Security" subtitle="Two-step sign-in for your own account" />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader
            title="Two-step sign-in"
            subtitle="A code from your phone, on top of your password"
            icon={<Smartphone size={16} />}
            action={
              status?.enrolled
                ? <Badge tone="green"><ShieldCheck size={11} /> On</Badge>
                : status?.required
                  ? <Badge tone="red"><ShieldAlert size={11} /> Required — not set up</Badge>
                  : <Badge tone="amber">Off</Badge>
            }
          />
          <div>
            {!status ? (
              <div className="h-24 animate-pulse rounded-xl bg-ink-100" />
            ) : status.enrolled ? (
              <>
                <p className="text-sm text-ink-600">
                  Set up {status.confirmedAt ? `on ${fmtDate(status.confirmedAt)}` : ""}. Every sign-in asks
                  for a code from your authenticator app.
                </p>
                <p className="mt-2 text-sm text-ink-600">
                  <span className="font-medium text-ink-900">{status.backupCodesRemaining}</span> backup
                  code{status.backupCodesRemaining === 1 ? "" : "s"} left.
                  {status.backupCodesRemaining <= 2 && (
                    <span className="ml-1 font-medium text-amber-700">
                      Issue a new set before you run out — with none left and no phone, only an administrator
                      can get you back in.
                    </span>
                  )}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button onClick={() => setDialog("regenerate")}>New backup codes</Button>
                  {status.required ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500 ring-1 ring-ink-200">
                      <AlertTriangle size={13} /> Your hospital requires this — it cannot be turned off here
                    </span>
                  ) : (
                    <Button variant="danger" onClick={() => setDialog("disable")}>Turn off</Button>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-ink-600">
                  {status.required
                    ? "Your hospital requires a second step on this account. You will be asked to set one up at your next sign-in — doing it now takes a minute."
                    : "You can sign in with a password alone. Adding a code from your phone means a stolen password is not enough on its own."}
                </p>
                <Button variant="primary" className="mt-4" icon={<KeyRound size={14} />} onClick={() => setEnrolling(true)}>
                  Set up two-step sign-in
                </Button>
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Your account" subtitle={currentUser?.email ?? ""} />
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-xs font-medium text-ink-500">Password</p>
              <p className="text-ink-700">
                Hashed with scrypt at the current OWASP cost. Changing it signs out every device.
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-ink-500">Sessions</p>
              <p className="text-ink-700">
                Stored on the server and valid for 7 days. Suspending an account, resetting a password or
                changing a second factor ends them immediately.
              </p>
            </div>
            {/*
              Said here rather than left to be discovered: the product does not
              send email, so "forgot password" goes through an administrator.
            */}
            <div>
              <p className="text-xs font-medium text-ink-500">Forgotten password</p>
              <p className="text-ink-700">
                This deployment has no mail server, so reset links are issued by your hospital&apos;s
                administrator rather than emailed.
              </p>
            </div>
          </div>
        </Card>
      </div>

      <Modal
        open={dialog !== null}
        onClose={closeDialog}
        title={dialog === "disable" ? "Turn off two-step sign-in" : "Issue new backup codes"}
        footer={
          <>
            <Button onClick={closeDialog}>Cancel</Button>
            <Button
              variant={dialog === "disable" ? "danger" : "primary"}
              disabled={busy || !password || code.trim().length < 6}
              onClick={submitDialog}
            >
              {busy ? "Checking…" : dialog === "disable" ? "Turn it off" : "Issue new codes"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          {dialog === "disable"
            ? "Your password alone will open this account again. Confirm with your password and a current code."
            : "The codes you have now stop working immediately. Confirm with your password and a current code."}
        </p>
        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}
        <div className="mt-4 space-y-3">
          <Field label="Your password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Code from your authenticator">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="font-mono tracking-[0.3em]"
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
