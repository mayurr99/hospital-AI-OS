"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";
import { readJson } from "@/lib/http";
import { AlertTriangle, ArrowLeft, Check, Eye, EyeOff, ShieldCheck } from "lucide-react";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"checking" | "invalid" | "ready" | "done">("checking");
  const [who, setWho] = useState<{ name: string; email: string } | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setState("invalid"); return; }
    fetch(`/api/auth/reset?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.valid) { setWho({ name: d.name, email: d.email }); setState("ready"); }
        else setState("invalid");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? "Could not change the password");
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password");
    } finally {
      setBusy(false);
    }
  }

  const tooShort = password.length > 0 && password.length < 10;
  const mismatch = confirm.length > 0 && confirm !== password;

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-6 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-ink-200">
        <Link href="/login" className="mb-5 inline-flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-800">
          <ArrowLeft size={13} /> Back to sign in
        </Link>

        {state === "checking" && <div className="h-40 animate-pulse rounded-xl bg-ink-100" />}

        {state === "invalid" && (
          <>
            <div className="flex items-center gap-2 text-rose-700">
              <AlertTriangle size={18} />
              <h1 className="text-lg font-semibold tracking-tight">This link no longer works</h1>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">
              Reset links last an hour and can be used once. Ask your administrator for a new one.
            </p>
            <Link href="/forgot"><Button className="mt-5 w-full">Request another</Button></Link>
          </>
        )}

        {state === "done" && (
          <>
            <div className="flex items-center gap-2 text-emerald-700">
              <Check size={18} />
              <h1 className="text-lg font-semibold tracking-tight">Password changed</h1>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">
              Everywhere that account was signed in has been signed out, including any device you did not
              recognise. Sign in with the new password.
            </p>
            <Link href="/login"><Button variant="primary" className="mt-5 w-full">Sign in</Button></Link>
          </>
        )}

        {state === "ready" && (
          <>
            <h1 className="text-xl font-semibold tracking-tight text-ink-900">Choose a new password</h1>
            {who && (
              <p className="mt-1 text-sm text-ink-500">
                For {who.name} · <span className="text-ink-700">{who.email}</span>
              </p>
            )}

            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}

            <form className="mt-5 space-y-3" onSubmit={submit}>
              <Field
                label="New password"
                hint="At least 10 characters."
                error={tooShort ? "At least 10 characters." : undefined}
              >
                <div className="relative">
                  <Input
                    type={showPw ? "text" : "password"}
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:bg-ink-100"
                    aria-label={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </Field>
              <Field label="Repeat it" error={mismatch ? "These do not match." : undefined}>
                <Input
                  type={showPw ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••••"
                />
              </Field>
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={busy || password.length < 10 || confirm !== password}
              >
                {busy ? "Saving…" : "Change password"}
              </Button>
            </form>

            <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-400">
              <ShieldCheck size={13} className="mt-0.5 shrink-0" />
              Changing the password signs out every device. If two-step sign-in is set up on this account, it
              stays on — you will still be asked for a code.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-ink-50" />}>
      <ResetForm />
    </Suspense>
  );
}
