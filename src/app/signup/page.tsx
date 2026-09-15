"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Field, Input } from "@/components/ui";
import { cx } from "@/lib/utils";
import { readJson } from "@/lib/http";
import { AlertTriangle, ArrowRight, CheckCircle2, Eye, EyeOff, ShieldCheck, Sparkles } from "lucide-react";

export default function SignupPage() {
  const [form, setForm] = useState({ hospitalName: "", adminName: "", email: "", phone: "", city: "", password: "" });
  const [showPw, setShowPw] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const strength =
    form.password.length >= 12 && /[^a-zA-Z0-9]/.test(form.password) ? "strong" :
    form.password.length >= 8 ? "fair" : "weak";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? "Could not create your account");
      window.location.assign("/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  const canSubmit = form.hospitalName && form.adminName && form.email && form.password.length >= 8 && accepted && !busy;

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.05fr]">
      {/* left */}
      <div className="relative hidden overflow-hidden bg-ink-900 px-10 py-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-35"
          style={{ background: "radial-gradient(800px 460px at 20% 10%, rgba(20,184,166,.5), transparent 60%), radial-gradient(600px 420px at 80% 85%, rgba(79,70,229,.4), transparent 60%)" }}
        />
        <div className="relative">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-500 font-bold">AI</div>
            <span className="text-lg font-semibold tracking-tight">Hospital AI OS</span>
          </Link>
          <Badge tone="brand" className="mt-10 bg-white/10 text-brand-200 ring-white/20">
            <Sparkles size={11} /> 7 days free · no card required
          </Badge>
          <h1 className="mt-5 max-w-md text-3xl font-semibold leading-tight tracking-tight">
            Your hospital&apos;s AI front desk and follow-up team, running this week.
          </h1>
          <ul className="mt-8 space-y-3">
            {[
              "Create your workspace in under a minute",
              "Answer a short setup questionnaire — departments, doctors, languages",
              "Choose exactly which modules to unlock",
              "Point recordings at your own disk or S3 bucket",
              "Connect Retell and ElevenLabs, or rehearse on the built-in simulator",
              "Land on a dashboard that is already configured for your hospital",
            ].map((s) => (
              <li key={s} className="flex items-start gap-2.5 text-sm text-ink-200">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-brand-400" /> {s}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative flex items-center gap-2 text-xs text-ink-400">
          <ShieldCheck size={13} /> Your data stays in your tenant. Secrets are stored server-side and never returned to the browser.
        </p>
      </div>

      {/* right */}
      <div className="flex items-center justify-center bg-white px-6 py-10">
        <form onSubmit={submit} className="w-full max-w-md">
          <Link href="/" className="mb-6 flex items-center gap-2 lg:hidden">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">AI</div>
            <span className="font-semibold text-ink-900">Hospital AI OS</span>
          </Link>

          <h2 className="text-xl font-semibold tracking-tight text-ink-900">Create your hospital workspace</h2>
          <p className="mt-1 text-sm text-ink-500">
            Already have one? <Link href="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link>
          </p>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <div className="mt-5 space-y-3">
            <Field label="Hospital name">
              <Input
                autoFocus
                placeholder="e.g. Sunrise Multispeciality Hospital"
                value={form.hospitalName}
                onChange={(e) => setForm({ ...form, hospitalName: e.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Your name">
                <Input placeholder="Dr. / Mr. / Ms." value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} />
              </Field>
              <Field label="City">
                <Input placeholder="Pune" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </Field>
            </div>
            <Field label="Work email" hint="This becomes your hospital admin login">
              <Input type="email" placeholder="you@hospital.in" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Mobile">
              <Input placeholder="+91 …" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Password" hint="At least 8 characters">
              <div className="relative">
                <Input
                  type={showPw ? "text" : "password"}
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
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
            {form.password && (
              <div className="flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-200">
                  <div
                    className={cx(
                      "h-full rounded-full transition-all",
                      strength === "strong" ? "w-full bg-emerald-500" : strength === "fair" ? "w-2/3 bg-amber-500" : "w-1/3 bg-rose-500",
                    )}
                  />
                </div>
                <span className="text-[11px] capitalize text-ink-500">{strength}</span>
              </div>
            )}

            <label className="flex items-start gap-2 pt-1 text-xs text-ink-600">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 accent-brand-600" />
              <span>
                I confirm I am authorised to create this workspace for my hospital, and I understand that live patient
                calling requires our own clinical governance sign-off before go-live.
              </span>
            </label>
          </div>

          <Button type="submit" variant="primary" className="mt-5 w-full" disabled={!canSubmit} icon={<ArrowRight size={16} />}>
            {busy ? "Creating your workspace…" : "Start 7-day free trial"}
          </Button>

          <p className="mt-3 text-center text-[11px] text-ink-400">
            Your trial includes 500 voice minutes on the built-in simulator. Connect your own Retell and ElevenLabs keys
            at any point during setup.
          </p>
        </form>
      </div>
    </div>
  );
}
