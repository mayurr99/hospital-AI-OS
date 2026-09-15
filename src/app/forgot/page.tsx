"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { readJson } from "@/lib/http";
import { AlertTriangle, ArrowLeft, Mail } from "lucide-react";

/**
 * Forgotten password.
 *
 * The confirmation is deliberately the same whether or not the address is
 * known, and it does not say "check your email" — this product sends none, and
 * the honest thing is to tell people where the link is actually coming from.
 */
export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await readJson<{ error?: string; message?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? "Could not send the request");
      setSent(data.message ?? "Request received.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-6 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-ink-200">
        <Link href="/login" className="mb-5 inline-flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-800">
          <ArrowLeft size={13} /> Back to sign in
        </Link>

        {sent ? (
          <>
            <div className="flex items-center gap-2 text-brand-700">
              <Mail size={18} />
              <h1 className="text-lg font-semibold tracking-tight">Request received</h1>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">{sent}</p>
            <p className="mt-3 text-xs leading-relaxed text-ink-500">
              Your administrator will see the request in the hospital&apos;s activity log and can issue you a
              link from the Staff screen. The link lasts an hour and can be used once.
            </p>
            <Link href="/login">
              <Button className="mt-5 w-full">Back to sign in</Button>
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold tracking-tight text-ink-900">Forgotten your password?</h1>
            <p className="mt-1 text-sm text-ink-500">
              Tell us the address you sign in with and your hospital&apos;s administrators will be asked to
              issue you a reset link.
            </p>

            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}

            <form className="mt-5 space-y-3" onSubmit={submit}>
              <Field label="Work email">
                <Input
                  type="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@hospital.in"
                />
              </Field>
              <Button type="submit" variant="primary" className="w-full" disabled={busy || !email}>
                {busy ? "Sending…" : "Request a reset link"}
              </Button>
            </form>

            <p className="mt-4 text-[11px] leading-relaxed text-ink-400">
              Nothing is emailed — this deployment has no mail server configured. The link is handed to you by
              an administrator, who will check who you are first.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
