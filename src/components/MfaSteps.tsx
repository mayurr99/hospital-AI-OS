"use client";

/**
 * The second-factor screens, shared by sign-in and by Settings → Security.
 *
 * They live in one place because they are the same three moments wherever a
 * user meets them — scan, confirm, write the backup codes down — and a second
 * copy of "write these down, they are shown once" is a copy that will eventually
 * disagree with the first.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/http";
import { AlertTriangle, Check, Copy, KeyRound, ShieldCheck, Smartphone } from "lucide-react";

/* ------------------------------ QR code ---------------------------- */

interface QrData { size: number; modules: boolean[] }

/**
 * The QR drawn as an SVG from the module matrix the server computed.
 *
 * Not an <img>, and not an HTML string: the picture is of a secret, and
 * drawing it from data means it is never fetched from anywhere and never has to
 * be exempted from the content security policy.
 */
export function QrMatrix({ qr, px = 208 }: { qr: QrData; px?: number }) {
  const { size, modules } = qr;
  const quiet = 2;
  const total = size + quiet * 2;
  const rects: React.ReactElement[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y * size + x]) {
        rects.push(<rect key={`${x}-${y}`} x={x + quiet} y={y + quiet} width={1} height={1} />);
      }
    }
  }
  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      width={px}
      height={px}
      role="img"
      aria-label="Authenticator setup QR code"
      shapeRendering="crispEdges"
      className="rounded-lg bg-white ring-1 ring-ink-200"
    >
      <rect width={total} height={total} fill="#fff" />
      <g fill="#0b1220">{rects}</g>
    </svg>
  );
}

/* --------------------------- code input ---------------------------- */

function CodeInput({
  value, onChange, onSubmit, busy, label = "6-digit code",
}: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; busy: boolean; label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <Field label={label} hint="From your authenticator app. A backup code works here too.">
      <Input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !busy) { e.preventDefault(); onSubmit(); } }}
        placeholder="123456"
        inputMode="text"
        autoComplete="one-time-code"
        spellCheck={false}
        className="font-mono tracking-[0.3em]"
      />
    </Field>
  );
}

/* -------------------------- backup codes --------------------------- */

export function BackupCodes({ codes, onDone, doneLabel = "I have saved these" }: {
  codes: string[]; onDone: () => void; doneLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-2 text-emerald-700">
        <ShieldCheck size={18} />
        <h2 className="text-lg font-semibold tracking-tight">Two-step sign-in is on</h2>
      </div>
      <p className="mt-2 text-sm text-ink-600">
        These ten backup codes each work once, in place of your phone. Keep them somewhere you can reach
        without it.
      </p>
      {/*
        Said plainly, because it is true: only hashes are stored, so this screen
        is the only time these exist. A vaguer "keep them safe" invites people to
        assume they can be looked up again.
      */}
      <p className="mt-1 text-sm font-medium text-amber-800">
        This is the only time they will be shown. They cannot be recovered — a new set can be issued, which
        stops the old ones working.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-1.5 rounded-xl border border-ink-200 bg-ink-50 p-3 font-mono text-sm text-ink-800">
        {codes.map((c) => <div key={c}>{c}</div>)}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          icon={copied ? <Check size={14} /> : <Copy size={14} />}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(codes.join("\n"));
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy codes"}
        </Button>
        <Button
          onClick={() => {
            const blob = new Blob(
              [`Hospital AI OS — backup sign-in codes\nEach code works once.\n\n${codes.join("\n")}\n`],
              { type: "text/plain" },
            );
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "hospital-ai-os-backup-codes.txt";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download
        </Button>
      </div>

      <label className="mt-4 flex items-start gap-2 text-sm text-ink-700">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-ink-300"
        />
        I have written these down or saved them somewhere safe.
      </label>

      <Button variant="primary" className="mt-3 w-full" disabled={!confirmed} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  );
}

/* ------------------------- verify (sign-in) ------------------------ */

export function MfaVerifyStep({
  challenge, name, onBack,
}: { challenge: string; name?: string; onBack: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ next?: string; usedBackupCode?: boolean; backupCodesRemaining?: number }>(
        "/api/auth/mfa/verify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challenge, code }),
        },
      );
      if (data.usedBackupCode) {
        /* Tell them before the page changes under them. */
        window.sessionStorage.setItem(
          "hos_backup_code_notice",
          String(data.backupCodesRemaining ?? 0),
        );
      }
      window.location.assign(data.next ?? "/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work");
      setCode("");
      setBusy(false);
    }
  }, [challenge, code]);

  return (
    <div>
      <button onClick={onBack} className="mb-4 text-xs text-ink-500 hover:text-ink-800">← Back</button>
      <div className="flex items-center gap-2">
        <Smartphone size={18} className="text-brand-600" />
        <h2 className="text-xl font-semibold tracking-tight text-ink-900">Two-step sign-in</h2>
      </div>
      <p className="mt-1 text-sm text-ink-500">
        {name ? `Hello ${name.split(" ")[0]} — open` : "Open"} your authenticator app and enter the code it
        is showing for this account.
      </p>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="mt-4">
        <CodeInput value={code} onChange={setCode} onSubmit={submit} busy={busy} />
      </div>
      <Button variant="primary" className="mt-3 w-full" disabled={busy || code.trim().length < 6} onClick={submit}>
        {busy ? "Checking…" : "Verify and sign in"}
      </Button>
      <p className="mt-4 text-[11px] leading-relaxed text-ink-400">
        Lost your phone? Use one of your backup codes above. If you have none left, your hospital
        administrator can reset the authenticator on your account.
      </p>
    </div>
  );
}

/* --------------------------- enrolment ----------------------------- */

interface SetupData { secret: string; uri: string; issuer: string; account: string; qr: QrData }

/**
 * Scan, confirm, then the codes.
 *
 * `challenge` is present when this is happening *during* sign-in, because the
 * hospital requires a second factor and the user has none: they hold no session
 * and get one only at the end of this. Without a challenge it is the same flow
 * run voluntarily from Settings.
 */
export function MfaEnrolStep({
  challenge, intro, onComplete,
}: {
  challenge?: string;
  intro?: React.ReactNode;
  onComplete: (result: { backupCodes: string[]; next?: string }) => void;
}) {
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    let alive = true;
    api<SetupData>("/api/auth/mfa/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(challenge ? { challenge } : {}),
    })
      .then((d) => { if (alive) setSetup(d); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "Could not start setup"); });
    return () => { alive = false; };
  }, [challenge]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ backupCodes: string[]; next?: string }>("/api/auth/mfa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(challenge ? { challenge, code } : { code }),
      });
      onComplete({ backupCodes: data.backupCodes ?? [], next: data.next });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code did not work");
      setCode("");
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <KeyRound size={18} className="text-brand-600" />
        <h2 className="text-xl font-semibold tracking-tight text-ink-900">Set up two-step sign-in</h2>
      </div>
      {intro ?? (
        <p className="mt-1 text-sm text-ink-500">
          Scan this with an authenticator app — Google Authenticator, Microsoft Authenticator and 1Password
          all work — then enter the six digits it shows.
        </p>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {!setup ? (
        <div className="mt-5 h-52 animate-pulse rounded-xl bg-ink-100" />
      ) : (
        <>
          <div className="mt-5 flex justify-center">
            <QrMatrix qr={setup.qr} />
          </div>

          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              className="text-xs text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
            >
              {showSecret ? "Hide setup key" : "No camera? Enter the key by hand"}
            </button>
            {showSecret && (
              <p className="mt-2 select-all break-all rounded-lg bg-ink-50 px-3 py-2 font-mono text-xs text-ink-800 ring-1 ring-ink-200">
                {setup.secret}
              </p>
            )}
          </div>

          <div className="mt-4">
            <CodeInput value={code} onChange={setCode} onSubmit={confirm} busy={busy} label="Code from the app" />
          </div>
          <Button variant="primary" className="mt-3 w-full" disabled={busy || code.trim().length < 6} onClick={confirm}>
            {busy ? "Checking…" : "Turn on two-step sign-in"}
          </Button>
        </>
      )}
    </div>
  );
}
