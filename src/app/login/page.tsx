"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/rbac";
import { readJson } from "@/lib/http";
import { BackupCodes, MfaEnrolStep, MfaVerifyStep } from "@/components/MfaSteps";
import {
  AlertTriangle, ArrowRight, BedDouble, Building2, Eye, EyeOff, Lock, PhoneCall, Receipt,
  ScrollText, Sparkles, Stethoscope,
} from "lucide-react";


/**
 * The demo hospital, as the server describes it.
 *
 * Nothing here is written into the page by hand: the hospital, the account the
 * button signs in as, and the counts all come from the database, so the front
 * door cannot advertise a hospital that is not there or a login that no longer
 * works.
 */
interface DemoEntry {
  personName: string;
  hospitalName: string;
  shortName: string;
  city: string;
  counts: { patients: number; wards: number; beds: number; labOrders: number; staff: number };
}

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

/**
 * What the product does, in the words a hospital would use.
 *
 * Deliberately capability only — no customers, no case studies, no numbers
 * about results. Nobody is running this yet, and a sign-in screen is the last
 * place to start implying otherwise.
 */
const CAPABILITIES = [
  {
    icon: <PhoneCall size={15} />,
    title: "An AI receptionist that never queues",
    body: "Answers, books, reschedules and confirms around the clock. Anything clinical or urgent is handed to a person, live, on the main line.",
  },
  {
    icon: <Stethoscope size={15} />,
    title: "Follow-up calls that reach everyone",
    body: "Post-discharge and chronic-care calls run to your protocol. Only the exceptions reach a clinician's queue — the rest are recorded and closed.",
  },
  {
    icon: <BedDouble size={15} />,
    title: "Wards, theatre, laboratory, pharmacy",
    body: "Admissions and bed state, theatre lists, lab orders with reference ranges and critical-value routing, stock and expiry — one record per patient throughout.",
  },
  {
    icon: <Receipt size={15} />,
    title: "Billing that follows the treatment",
    body: "Charges are raised from what was actually done — the admission, the test, the drug — rather than typed again into a separate system.",
  },
] as const;

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [orgChoices, setOrgChoices] = useState<{ orgId: string; orgName: string; role: string }[] | null>(null);
  /*
   * A sign-in that has passed the password and is waiting on the second factor.
   * It is not a session and grants nothing — the server will only exchange it
   * for one when a code is produced, so holding it in React state is safe.
   */
  const [mfa, setMfa] = useState<{ mode: "verify" | "enrol"; challenge: string; name?: string; channel?: "authenticator" | "email"; email?: string } | null>(null);
  const [newCodes, setNewCodes] = useState<{ codes: string[]; next: string } | null>(null);
  /*
   * Whether this deployment has demo hospitals at all.
   *
   * Starts false so a server holding real patients never flashes a panel
   * offering one-click sign-in and printing a shared password — even for the
   * moment before the answer arrives.
   */
  const [demoAvailable, setDemoAvailable] = useState(false);
  /*
   * A server nobody has signed up on yet. Worth knowing, because otherwise a
   * correct password gets the same "does not match an account" as a wrong one,
   * and the person spends ten minutes checking their typing.
   */
  const [noHospitalsYet, setNoHospitalsYet] = useState(false);
  /* The one-click way in, described by the server — see /api/auth/demo. */
  const [entry, setEntry] = useState<DemoEntry | null>(null);
  useEffect(() => {
    fetch("/api/auth/demo")
      .then((r) => r.json())
      .then((d) => {
        setDemoAvailable(Boolean(d?.demoAvailable));
        setNoHospitalsYet(Boolean(d?.noHospitalsYet));
        setEntry(d?.entry ?? null);
      })
      .catch(() => setDemoAvailable(false));
  }, []);

  async function attempt(mail: string, pass: string, orgId?: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: mail, password: pass, orgId }),
      });
      const data = await readJson<{
        error?: string;
        needsOrgChoice?: boolean;
        options?: { orgId: string; orgName: string; role: string }[];
        needsMfa?: boolean;
        mode?: "verify" | "enrol";
        challenge?: string;
        name?: string;
        channel?: "authenticator" | "email";
        email?: string;
        next?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error ?? "Sign in failed");
      if (data.needsOrgChoice) {
        setOrgChoices(data.options ?? []);
        setBusy(false);
        return;
      }
      if (data.needsMfa && data.challenge) {
        setMfa({ mode: data.mode ?? "verify", challenge: data.challenge, name: data.name, channel: data.channel, email: data.email });
        setBusy(false);
        return;
      }
      window.location.assign(data.next ?? "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setBusy(false);
    }
  }

  /*
   * Open the demo hospital.
   *
   * No email, no password: the server decides which demo tenant exists and
   * signs the visitor into it. That is why nothing on this page — or in the
   * bundle it compiles into — contains a credential.
   */
  async function openDemo() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/demo", { method: "POST" });
      const data = await readJson<{ error?: string; next?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? "Could not open the demo hospital");
      window.location.assign(data.next ?? "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the demo hospital");
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* left — what this is */}
      <div className="relative hidden overflow-hidden bg-ink-900 px-10 py-12 text-white lg:flex lg:flex-col">
        <div
          className="pointer-events-none absolute inset-0 opacity-35"
          style={{ background: "radial-gradient(820px 460px at 15% 8%, rgba(20,184,166,.5), transparent 60%), radial-gradient(620px 400px at 85% 88%, rgba(79,70,229,.4), transparent 60%)" }}
        />
        <div className="relative flex flex-1 flex-col">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-500 font-bold">AI</div>
            <span className="text-lg font-semibold tracking-tight">Hospital AI OS</span>
          </Link>

          <h1 className="mt-12 max-w-md text-3xl font-semibold leading-tight tracking-tight">
            The hospital&apos;s whole day, in one system that also answers the phone.
          </h1>
          <p className="mt-3.5 max-w-md text-sm leading-relaxed text-ink-300">
            Patient records, wards, theatre, laboratory, pharmacy and billing in one place — with an AI
            receptionist and follow-up caller working the same records your staff do, in Marathi, Hindi and
            English.
          </p>

          <div className="mt-9 max-w-md space-y-4">
            {CAPABILITIES.map((c) => (
              <div key={c.title} className="flex gap-3">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 text-brand-200">
                  {c.icon}
                </span>
                <span>
                  <span className="block text-sm font-medium text-white">{c.title}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-400">{c.body}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="mt-auto pt-9">
            {/*
              The claims a hospital's IT department will ask about, and only the
              ones the software actually does. Nothing here describes a customer
              or a deployment, because there are none yet.
            */}
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-400">
              <span className="flex items-center gap-1.5"><Lock size={12} /> Two-step sign-in for clinical access</span>
              <span className="flex items-center gap-1.5"><ScrollText size={12} /> Every action attributed and audited</span>
              <span className="flex items-center gap-1.5"><Building2 size={12} /> Each hospital&apos;s data isolated</span>
            </p>
          </div>
        </div>
      </div>

      {/* right — real sign in */}
      <div className="flex items-center justify-center bg-white px-6 py-10">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-6 flex items-center gap-2 lg:hidden">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">AI</div>
            <span className="font-semibold text-ink-900">Hospital AI OS</span>
          </Link>

          {newCodes ? (
            <BackupCodes
              codes={newCodes.codes}
              doneLabel="Continue to the dashboard"
              onDone={() => window.location.assign(newCodes.next)}
            />
          ) : mfa?.mode === "enrol" ? (
            <MfaEnrolStep
              challenge={mfa.challenge}
              intro={
                <p className="mt-1 text-sm text-ink-500">
                  Your hospital requires a second step for this account, and there is no authenticator on it
                  yet. Set one up now to finish signing in — your password alone will not open the patient
                  records.
                </p>
              }
              onComplete={(r) => setNewCodes({ codes: r.backupCodes, next: r.next ?? "/dashboard" })}
            />
          ) : mfa ? (
            <MfaVerifyStep challenge={mfa.challenge} name={mfa.name} channel={mfa.channel} email={mfa.email} onBack={() => setMfa(null)} />
          ) : orgChoices ? (
            <>
              <button onClick={() => setOrgChoices(null)} className="mb-4 text-xs text-ink-500 hover:text-ink-800">← Back</button>
              <h2 className="text-xl font-semibold tracking-tight text-ink-900">Choose a hospital</h2>
              <p className="mt-1 text-sm text-ink-500">This email has access to more than one workspace.</p>
              <div className="mt-5 space-y-2">
                {orgChoices.map((o) => (
                  <button
                    key={o.orgId}
                    onClick={() => attempt(email, password, o.orgId)}
                    className="flex w-full items-center gap-3 rounded-xl border border-ink-200 px-3 py-2.5 text-left transition hover:border-brand-400 hover:bg-brand-50/40"
                  >
                    <Building2 size={16} className="text-ink-400" />
                    <span className="flex-1">
                      <span className="block text-sm font-medium text-ink-900">{o.orgName}</span>
                      <span className="block text-[11px] text-ink-500">{ROLE_LABELS[o.role as keyof typeof ROLE_LABELS]}</span>
                    </span>
                    <ArrowRight size={14} className="text-ink-400" />
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              {/*
                The front door for someone who has come to look at the software
                rather than to do a shift. One button, into the fullest demo
                tenant, as the role that can see every module — a grid of eight
                role choices is a question, and a visitor who has to answer it
                before seeing anything often just leaves.

                It only exists when the server says a demo tenant does, and it
                says plainly that the data is invented.
              */}
              {demoAvailable && entry && (
                <div className="mb-6 overflow-hidden rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white">
                  <div className="p-4">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700">
                      <Sparkles size={12} /> Look around first
                    </p>
                    <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-ink-900">
                      Open {entry.hospitalName}
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-ink-600">
                      A working hospital with its records already in it — wards, laboratory, pharmacy,
                      billing and the AI call console. No sign-up, nothing to fill in.
                    </p>

                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-500">
                      <span><b className="text-ink-900">{compact(entry.counts.patients)}</b> patients</span>
                      <span><b className="text-ink-900">{entry.counts.wards}</b> wards</span>
                      <span><b className="text-ink-900">{entry.counts.beds}</b> beds</span>
                      <span><b className="text-ink-900">{compact(entry.counts.labOrders)}</b> lab orders</span>
                      <span><b className="text-ink-900">{entry.counts.staff}</b> staff</span>
                    </div>

                    <Button
                      variant="primary"
                      className="mt-3.5 w-full"
                      disabled={busy}
                      onClick={openDemo}
                    >
                      {busy ? "Opening…" : `Explore the ${entry.shortName} dashboard`}
                      <ArrowRight size={15} />
                    </Button>
                    <p className="mt-2 text-center text-[10px] leading-relaxed text-ink-400">
                      Signs you in as {entry.personName}, the hospital administrator, who can see every part of
                      the software. All records are invented — no real patient is in here.
                    </p>
                  </div>
                </div>
              )}

              <h2 className="text-xl font-semibold tracking-tight text-ink-900">
                {demoAvailable && entry ? "Or sign in to your hospital" : "Sign in"}
              </h2>
              <p className="mt-1 text-sm text-ink-500">
                New hospital? <Link href="/signup" className="font-medium text-brand-700 hover:underline">Start a free trial</Link>
              </p>

              {/*
                Shown only when the database genuinely holds no hospital. It
                names the cause, because the common way to arrive here is a
                production build started on an empty data directory — which
                deliberately seeds nothing, and used to leave the screen
                rejecting perfectly correct credentials with no explanation.
              */}
              {noHospitalsYet && (
                <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50/60 p-3.5">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-900">
                    <Building2 size={15} /> No hospitals on this server yet
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600">
                    Nobody has signed up here, so no account can match. Create the first hospital — that account
                    becomes its administrator.
                  </p>
                  <Link href="/signup">
                    <Button variant="primary" size="sm" className="mt-2.5 w-full">Create the first hospital</Button>
                  </Link>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
                    Wanted the demo hospitals instead? A production build does not create them. Start the server
                    with <code className="rounded bg-white px-1 py-0.5 font-mono text-[10px] ring-1 ring-ink-200">SEED_DEMO=1</code>,
                    or run <code className="rounded bg-white px-1 py-0.5 font-mono text-[10px] ring-1 ring-ink-200">npm run dev</code>.
                  </p>
                </div>
              )}

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
                </div>
              )}

              <form
                className="mt-5 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  attempt(email, password);
                }}
              >
                <Field label="Work email">
                  <Input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@hospital.in" />
                </Field>
                <Field label="Password">
                  <div className="relative">
                    <Input
                      type={showPw ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
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
                <Button type="submit" variant="primary" className="w-full" disabled={busy || !email || !password}>
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
              </form>

              <p className="mt-3 text-center text-xs text-ink-500">
                <Link href="/forgot" className="hover:text-ink-800 hover:underline">Forgotten your password?</Link>
              </p>

              <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-ink-400">
                <Lock size={12} /> scrypt passwords, server-side sessions, and a second step for anyone who can
                open a patient record.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
