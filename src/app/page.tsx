"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@/components/ui";
import {
  Activity, ArrowRight, BedDouble, Bot, CheckCircle2, Database, FlaskConical, HardDrive, Languages,
  Lock, Mic, PhoneCall, PhoneForwarded, Receipt, ShieldCheck, Siren, Sparkles, Stethoscope,
} from "lucide-react";

const MODULES = [
  { icon: <PhoneCall size={16} />, t: "AI receptionist", s: "24×7 inbound booking, rescheduling, FAQs and human transfer in Marathi, Hindi and English." },
  { icon: <Stethoscope size={16} />, t: "Follow-up agent", s: "Protocol-driven post-discharge calls that capture structured answers, not free text." },
  { icon: <Siren size={16} />, t: "Critical forwarding", s: "A red flag hands the live call to your main line, opens an escalation and starts the SLA clock." },
  { icon: <Mic size={16} />, t: "Recording & storage", s: "Every call recorded to your own disk or S3 bucket, with retention you control." },
  { icon: <BedDouble size={16} />, t: "Hospital operations", s: "Beds, OT, labs, pharmacy and emergency triage in the same workspace." },
  { icon: <Receipt size={16} />, t: "Billing & messaging", s: "Invoices, collections and two-way WhatsApp with AI-to-human handover." },
];

const PLANS = [
  {
    name: "Trial",
    price: "Free for 7 days",
    sub: "No card required",
    features: ["1 facility", "10 staff accounts", "500 voice minutes", "Simulator voice agent", "Local recording storage", "Full clinical workflow"],
    cta: "Start free trial",
    highlight: false,
  },
  {
    name: "AI Care",
    price: "₹1.5–6 lakh",
    sub: "per hospital / month",
    features: ["Everything in the trial", "Retell + ElevenLabs live voice", "Your own S3 bucket", "Unlimited staff seats", "HIS / FHIR integration", "Priority support"],
    cta: "Start free trial",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    sub: "hospital groups",
    features: ["Multi-hospital hierarchy", "Dedicated VPC or on-prem", "SSO, SIEM, dedicated keys", "Custom care pathways", "ABDM readiness programme", "SLA and named CSM"],
    cta: "Talk to us",
    highlight: false,
  },
];

export default function LandingPage() {
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.user) router.replace(d.onboardingComplete === false ? "/onboarding" : d.user.role === "patient" ? "/portal" : "/dashboard");
      })
      .catch(() => {});
  }, [router]);

  return (
    <div className="min-h-screen bg-white">
      {/* nav */}
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">AI</div>
          <span className="font-semibold tracking-tight text-ink-900">Hospital AI OS</span>
          <nav className="ml-6 hidden gap-5 text-sm text-ink-600 md:flex">
            <a href="#modules" className="hover:text-ink-900">Platform</a>
            <a href="#voice" className="hover:text-ink-900">Voice</a>
            <a href="#trust" className="hover:text-ink-900">Security</a>
            <a href="#pricing" className="hover:text-ink-900">Pricing</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login"><Button size="sm">Sign in</Button></Link>
            <Link href="/signup"><Button size="sm" variant="primary">Start free trial</Button></Link>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden border-b border-ink-200 bg-ink-900 px-5 py-20 text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(900px 480px at 12% 0%, rgba(20,184,166,.5), transparent 60%), radial-gradient(700px 420px at 88% 90%, rgba(79,70,229,.4), transparent 60%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl">
          <Badge tone="brand" className="bg-white/10 text-brand-200 ring-white/20">
            <Sparkles size={11} /> Multi-hospital SaaS · 7-day free trial
          </Badge>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            The AI patient engagement layer your hospital can actually govern.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-300">
            Multilingual AI voice for the front desk and post-discharge follow-up, with deterministic clinical protocols,
            live escalation to your own main line, recordings in your own storage, and whole-hospital operations — sitting
            beside your existing HIS, not replacing it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/signup">
              <Button variant="primary" icon={<ArrowRight size={16} />} className="px-5 py-2.5">
                Start your 7-day free trial
              </Button>
            </Link>
            <Link href="/login">
              <Button className="border-white/20 bg-white/10 text-white ring-white/20 hover:bg-white/20 px-5 py-2.5">
                Sign in to your hospital
              </Button>
            </Link>
            <span className="text-xs text-ink-400">No card. Setup takes about four minutes.</span>
          </div>

          <div className="mt-12 grid max-w-4xl gap-3 sm:grid-cols-4">
            {[
              ["मराठी · हिन्दी · English", "Code-mixed voice, detected live"],
              ["< 15 min", "Red-flag acknowledgement SLA"],
              ["Your bucket", "Recordings never pooled"],
              ["Tenant-isolated", "Enforced server-side"],
            ].map(([a, b]) => (
              <div key={a} className="rounded-xl bg-white/5 p-3.5 ring-1 ring-white/10">
                <p className="text-sm font-semibold">{a}</p>
                <p className="mt-0.5 text-[11px] text-ink-400">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* modules */}
      <section id="modules" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-semibold tracking-tight text-ink-900">One workspace, the whole patient journey</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-600">
          Turn on only what you need at setup. Everything else stays out of your staff&apos;s way until you unlock it.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <div key={m.t} className="rounded-xl border border-ink-200 p-5 transition hover:border-brand-300 hover:shadow-sm">
              <div className="inline-grid h-9 w-9 place-items-center rounded-lg bg-brand-50 text-brand-700">{m.icon}</div>
              <h3 className="mt-3 text-sm font-semibold text-ink-900">{m.t}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-600">{m.s}</p>
            </div>
          ))}
        </div>
      </section>

      {/* voice stack */}
      <section id="voice" className="border-y border-ink-200 bg-ink-50 px-5 py-16">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-ink-900">Bring your own voice stack</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">
              Connect Retell for telephony and conversation and ElevenLabs for speech, with your own keys and your own
              spend. No vendor is baked in — the platform talks to them through one interface, and ships with a built-in
              simulator so your team can rehearse the whole workflow before a single rupee of voice spend.
            </p>
            <div className="mt-6 space-y-3">
              {[
                [<Bot key="a" size={15} />, "Retell", "Agent selection, outbound calling, live warm transfer and webhooks."],
                [<Languages key="b" size={15} />, "ElevenLabs", "Voice library, multilingual model, stability and similarity tuning, instant preview."],
                [<PhoneForwarded key="c" size={15} />, "Your main line", "Critical calls forwarded to the number you configure, with an after-hours route and a fallback."],
                [<HardDrive key="d" size={15} />, "Your storage", "Local encrypted volume or any S3-compatible bucket — AWS, MinIO, R2 or Wasabi."],
              ].map(([icon, t, s]) => (
                <div key={t as string} className="flex gap-3 rounded-xl border border-ink-200 bg-white p-4">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">{icon}</span>
                  <div>
                    <p className="text-sm font-semibold text-ink-900">{t as string}</p>
                    <p className="text-[13px] leading-relaxed text-ink-600">{s as string}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">What happens on a critical call</p>
            <ol className="mt-4 space-y-4">
              {[
                ["Patient reports a red-flag symptom", "The deterministic protocol engine matches it — the language model never decides urgency."],
                ["Routine flow stops immediately", "The agent may not continue the questionnaire or offer any advice."],
                ["Live call forwarded to your main line", "Warm, cold or conference, with an after-hours number and a fallback if nobody picks up."],
                ["Escalation opened, SLA running", "Assigned, acknowledged and resolved by a named human — all recorded."],
                ["Nothing is dropped", "If no line answers, a high-priority task is raised so a person calls the patient back."],
              ].map(([t, s], i) => (
                <li key={t} className="flex gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-rose-600 text-[11px] font-bold text-white">{i + 1}</span>
                  <div>
                    <p className="text-sm font-medium text-ink-900">{t}</p>
                    <p className="text-[12px] leading-relaxed text-ink-600">{s}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* trust */}
      <section id="trust" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-semibold tracking-tight text-ink-900">Built for the people who say no</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-600">
          The CISO, the clinical lead and the HIS vendor all have to be comfortable. These are the answers they ask for.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            [<ShieldCheck key="1" size={16} />, "Governed, not prompted", "Agents have a tool allow-list. Diagnosing, prescribing and changing a dose are absent from the runtime, not discouraged in a prompt."],
            [<Lock key="2" size={16} />, "Tenant isolation", "The tenant comes from the session on the server. No endpoint can return another hospital's records."],
            [<Database key="3" size={16} />, "Your data, your storage", "Recordings and exports go to the storage you configure, with separate retention for audio, transcripts and summaries."],
            [<Activity key="4" size={16} />, "Everything audited", "Configuration changes, clinical access, recording playback and every export are recorded with actor, scope and time."],
          ].map(([icon, t, s]) => (
            <div key={t as string} className="rounded-xl border border-ink-200 p-5">
              <div className="inline-grid h-9 w-9 place-items-center rounded-lg bg-ink-900 text-white">{icon}</div>
              <h3 className="mt-3 text-sm font-semibold text-ink-900">{t as string}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-600">{s as string}</p>
            </div>
          ))}
        </div>
      </section>

      {/* pricing */}
      <section id="pricing" className="border-t border-ink-200 bg-ink-50 px-5 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-2xl font-semibold tracking-tight text-ink-900">Start free, then pay for what your hospital runs</h2>
          <p className="mt-2 text-sm text-ink-600">Every trial includes the full clinical workflow. Voice spend is yours and metered transparently.</p>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {PLANS.map((p) => (
              <div
                key={p.name}
                className={`rounded-2xl border p-6 ${p.highlight ? "border-brand-500 bg-white shadow-lg ring-1 ring-brand-500/20" : "border-ink-200 bg-white"}`}
              >
                {p.highlight && <Badge tone="brand" className="mb-3">Most hospitals start here</Badge>}
                <p className="text-sm font-semibold text-ink-900">{p.name}</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">{p.price}</p>
                <p className="text-xs text-ink-500">{p.sub}</p>
                <ul className="mt-4 space-y-2">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[13px] text-ink-700">
                      <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-brand-600" /> {f}
                    </li>
                  ))}
                </ul>
                <Link href="/signup" className="mt-5 block">
                  <Button variant={p.highlight ? "primary" : "secondary"} className="w-full">{p.cta}</Button>
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-ink-500">
            Indicative commercial bands for planning. Final pricing depends on call volume, integrations, deployment
            model and clinical configuration.
          </p>
        </div>
      </section>

      {/* demo strip */}
      <section className="mx-auto max-w-6xl px-5 py-14">
        <div className="flex flex-wrap items-center gap-6 rounded-2xl border border-ink-200 bg-white p-6">
          <FlaskConical size={22} className="text-brand-600" />
          <div className="min-w-[240px] flex-1">
            <p className="text-sm font-semibold text-ink-900">Want to look around first?</p>
            <p className="text-[13px] text-ink-600">
              Two fully populated demo hospitals are preloaded with synthetic patients, calls and escalations. Sign in as
              any role to see exactly what that person can and cannot do.
            </p>
          </div>
          <Link href="/login"><Button>Open a demo hospital</Button></Link>
        </div>
      </section>

      <footer className="border-t border-ink-200 px-5 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 text-xs text-ink-500">
          <div className="grid h-6 w-6 place-items-center rounded bg-brand-600 text-[10px] font-bold text-white">AI</div>
          <span>Hospital AI OS</span>
          <span className="ml-auto">All demo data is synthetic. Clinical deployment requires the hospital&apos;s own governance review.</span>
        </div>
      </footer>
    </div>
  );
}
