"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input, Select, Toggle } from "@/components/ui";
import { cx, LANGUAGE_LABELS } from "@/lib/utils";
import type { LanguageCode } from "@/lib/types";
import { readJson } from "@/lib/http";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Bot, Building2, CheckCircle2, Cloud, HardDrive, Languages,
  Loader2, Plus, Rocket, Stethoscope, Trash2, Users, Wand2,
} from "lucide-react";

const DEPARTMENT_LIBRARY = [
  "General Medicine", "Cardiology", "Orthopaedics", "Obstetrics & Gynaecology", "Paediatrics", "Oncology",
  "Nephrology", "Pulmonology", "Neurology", "Gastroenterology", "Urology", "Dermatology", "ENT",
  "Ophthalmology", "Dentistry", "Psychiatry", "Radiology", "Pathology Lab",
];

const GOALS = [
  { key: "front_desk", label: "Our phone lines are always busy", blurb: "Start with the AI receptionist — booking, rescheduling and FAQs answered 24×7.", features: ["ai_receptionist", "appointments", "messaging", "analytics"] },
  { key: "followup", label: "We lose patients after discharge", blurb: "Start with protocol-driven follow-up calls and a clinician review queue.", features: ["followup_agent", "doctor_crm", "care_queue", "escalation", "call_recording", "analytics"] },
  { key: "whole", label: "We want the whole hospital in one place", blurb: "Turn on operations too — beds, OT, labs, pharmacy, emergency and billing.", features: ["ai_receptionist", "followup_agent", "call_recording", "doctor_crm", "care_queue", "escalation", "appointments", "ipd", "ot", "labs", "pharmacy", "emergency", "billing", "messaging", "portal", "data_io", "analytics"] },
];

interface FeatureDef { key: string; label: string; group: string; blurb: string }

interface Answers {
  goal?: string;
  hospitalName?: string;
  city?: string;
  state?: string;
  beds?: number;
  branches?: { name: string; address: string; phone: string; beds: number }[];
  departments?: string[];
  doctors?: { name: string; department: string; speciality: string; minutes: number; fee: number }[];
  languages?: LanguageCode[];
  monthlyCallVolume?: string;
  hisVendor?: string;
  features?: string[];
  storageDriver?: "local" | "s3";
  voiceProvider?: "retell" | "simulator";
  mainLineNumber?: string;
  loadSampleData?: boolean;
}

const STEPS = ["Your goal", "Hospital", "Departments", "Doctors", "Languages", "Features", "Storage", "Voice & escalation", "Review"];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({
    languages: ["mr", "hi", "en"],
    storageDriver: "local",
    voiceProvider: "simulator",
    loadSampleData: true,
    branches: [],
    doctors: [],
  });
  const [catalog, setCatalog] = useState<FeatureDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [trialDays, setTrialDays] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const me = await fetch("/api/auth/me").then((r) =>
        readJson<{ user?: unknown; onboardingComplete?: boolean; subscription?: { trialDaysLeft?: number } }>(r),
      );
      if (!me.user) {
        router.replace("/login");
        return;
      }
      if (me.onboardingComplete) {
        router.replace("/dashboard");
        return;
      }
      setTrialDays(me.subscription?.trialDaysLeft ?? null);
      const boot = await fetch("/api/bootstrap").then((r) =>
        readJson<{ featureCatalog?: FeatureDef[]; org?: { name?: string } }>(r),
      );
      setCatalog(boot.featureCatalog ?? []);
      setOrgName(boot.org?.name ?? "");
      const saved = await fetch("/api/onboarding").then((r) =>
        readJson<{ answers?: Partial<Answers>; step?: number }>(r),
      );
      setAnswers((prev) => ({ ...prev, hospitalName: boot.org?.name ?? "", ...saved.answers }));
      setStep(saved.step ?? 0);
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [router]);

  const set = (patch: Partial<Answers>) => setAnswers((prev) => ({ ...prev, ...patch }));

  async function saveProgress(nextStep: number) {
    setStep(nextStep);
    void fetch("/api/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: nextStep, answers }),
    });
  }

  const groups = useMemo(() => Array.from(new Set(catalog.map((f) => f.group))), [catalog]);

  const canContinue = (() => {
    if (step === 0) return Boolean(answers.goal);
    if (step === 1) return Boolean(answers.hospitalName?.trim());
    if (step === 2) return Boolean(answers.departments?.length);
    if (step === 5) return Boolean(answers.features?.length);
    if (step === 7) return answers.voiceProvider === "simulator" || Boolean(answers.mainLineNumber);
    return true;
  })();

  async function finish() {
    setProvisioning(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const data = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? "Setup failed");
      setDone(true);
      setTimeout(() => window.location.assign("/dashboard"), 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup failed");
      setProvisioning(false);
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-100">
        <p className="flex items-center gap-2 text-sm text-ink-500"><Loader2 size={15} className="animate-spin" /> Loading your workspace…</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-100 px-6">
        <div className="animate-fade-up max-w-md text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-600 text-white">
            <Rocket size={28} />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink-900">{answers.hospitalName} is ready</h1>
          <p className="mt-2 text-sm text-ink-600">
            {answers.departments?.length} departments, {answers.doctors?.length ?? 0} doctors and{" "}
            {answers.features?.length} modules configured. Taking you to your dashboard…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-100">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">AI</div>
          <span className="font-semibold text-ink-900">Set up {orgName || "your hospital"}</span>
          {trialDays !== null && (
            <Badge tone="amber" className="ml-2">{trialDays} days left in trial</Badge>
          )}
          <span className="ml-auto text-xs text-ink-500">Step {step + 1} of {STEPS.length}</span>
        </div>
        <div className="h-1 w-full bg-ink-200">
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-8">
        <div className="mb-6 flex flex-wrap gap-1.5">
          {STEPS.map((s, i) => (
            <button
              key={s}
              onClick={() => i <= step && saveProgress(i)}
              disabled={i > step}
              className={cx(
                "rounded-full px-3 py-1 text-[11px] font-medium transition",
                i === step ? "bg-brand-600 text-white" : i < step ? "bg-brand-50 text-brand-700 hover:bg-brand-100" : "bg-ink-200 text-ink-400",
              )}
            >
              {i + 1}. {s}
            </button>
          ))}
        </div>

        <Card className="min-h-[380px]">
          {/* ---------------------------- 0 goal ---------------------------- */}
          {step === 0 && (
            <div>
              <h2 className="text-lg font-semibold text-ink-900">What should we fix first?</h2>
              <p className="mt-1 text-sm text-ink-500">
                This only pre-selects your modules — you can change every one of them on the next screens.
              </p>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {GOALS.map((g) => (
                  <button
                    key={g.key}
                    onClick={() => set({ goal: g.key, features: g.features })}
                    className={cx(
                      "rounded-xl border p-4 text-left transition",
                      answers.goal === g.key ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500/30" : "border-ink-200 hover:border-ink-300 hover:bg-ink-50",
                    )}
                  >
                    <p className="text-sm font-semibold text-ink-900">{g.label}</p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-600">{g.blurb}</p>
                    <p className="mt-2 text-[11px] text-brand-700">{g.features.length} modules pre-selected</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* -------------------------- 1 hospital -------------------------- */}
          {step === 1 && (
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900"><Building2 size={18} className="text-brand-600" /> Your hospital</h2>
              <p className="mt-1 text-sm text-ink-500">Used on patient-facing messages, call scripts and reports.</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <Field label="Hospital name" className="sm:col-span-2">
                  <Input value={answers.hospitalName ?? ""} onChange={(e) => set({ hospitalName: e.target.value })} />
                </Field>
                <Field label="City"><Input value={answers.city ?? ""} onChange={(e) => set({ city: e.target.value })} placeholder="Pune" /></Field>
                <Field label="State"><Input value={answers.state ?? ""} onChange={(e) => set({ state: e.target.value })} placeholder="Maharashtra" /></Field>
                <Field label="Total beds" hint="Used to size the ward layout if you enable IPD">
                  <Input type="number" value={answers.beds ?? ""} onChange={(e) => set({ beds: Number(e.target.value) })} placeholder="80" />
                </Field>
                <Field label="Existing HIS / EMR" hint="So we know what to integrate with later">
                  <Input value={answers.hisVendor ?? ""} onChange={(e) => set({ hisVendor: e.target.value })} placeholder="e.g. Insta, eHospital, Medixcel, none" />
                </Field>
              </div>

              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-ink-800">Branches</p>
                  <Button
                    size="sm"
                    icon={<Plus size={13} />}
                    onClick={() => set({ branches: [...(answers.branches ?? []), { name: "", address: "", phone: "", beds: 0 }] })}
                  >
                    Add branch
                  </Button>
                </div>
                {(answers.branches ?? []).length === 0 ? (
                  <p className="rounded-lg bg-ink-50 p-3 text-xs text-ink-500">
                    No branches added — we will create a single main facility for you.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(answers.branches ?? []).map((b, i) => (
                      <div key={i} className="grid gap-2 rounded-lg border border-ink-200 p-2.5 sm:grid-cols-[1.3fr_1.6fr_1fr_0.6fr_auto]">
                        <Input placeholder="Branch name" value={b.name} onChange={(e) => { const next = [...answers.branches!]; next[i] = { ...b, name: e.target.value }; set({ branches: next }); }} />
                        <Input placeholder="Address" value={b.address} onChange={(e) => { const next = [...answers.branches!]; next[i] = { ...b, address: e.target.value }; set({ branches: next }); }} />
                        <Input placeholder="Phone" value={b.phone} onChange={(e) => { const next = [...answers.branches!]; next[i] = { ...b, phone: e.target.value }; set({ branches: next }); }} />
                        <Input type="number" placeholder="Beds" value={b.beds || ""} onChange={(e) => { const next = [...answers.branches!]; next[i] = { ...b, beds: Number(e.target.value) }; set({ branches: next }); }} />
                        <Button variant="ghost" size="sm" onClick={() => set({ branches: answers.branches!.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ------------------------- 2 departments ------------------------ */}
          {step === 2 && (
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900"><Stethoscope size={18} className="text-brand-600" /> Which departments do you run?</h2>
              <p className="mt-1 text-sm text-ink-500">
                The AI receptionist can only book into departments that exist here, so pick everything patients call about.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {DEPARTMENT_LIBRARY.map((d) => {
                  const on = answers.departments?.includes(d);
                  return (
                    <button
                      key={d}
                      onClick={() =>
                        set({ departments: on ? answers.departments!.filter((x) => x !== d) : [...(answers.departments ?? []), d] })
                      }
                      className={cx(
                        "rounded-full px-3.5 py-1.5 text-sm font-medium transition",
                        on ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-200",
                      )}
                    >
                      {on && <CheckCircle2 size={12} className="mr-1 inline" />}
                      {d}
                    </button>
                  );
                })}
              </div>
              <p className="mt-4 text-xs text-ink-500">{answers.departments?.length ?? 0} selected</p>
            </div>
          )}

          {/* --------------------------- 3 doctors -------------------------- */}
          {step === 3 && (
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900"><Users size={18} className="text-brand-600" /> Add your doctors</h2>
              <p className="mt-1 text-sm text-ink-500">
                Consultation length and fee generate the bookable slots the AI offers callers. You can add the rest later.
              </p>
              <div className="mt-5 space-y-2">
                {(answers.doctors ?? []).map((doc, i) => (
                  <div key={i} className="grid gap-2 rounded-lg border border-ink-200 p-2.5 sm:grid-cols-[1.4fr_1.2fr_0.7fr_0.7fr_auto]">
                    <Input placeholder="Dr. name" value={doc.name} onChange={(e) => { const next = [...answers.doctors!]; next[i] = { ...doc, name: e.target.value }; set({ doctors: next }); }} />
                    <Select value={doc.department} onChange={(e) => { const next = [...answers.doctors!]; next[i] = { ...doc, department: e.target.value, speciality: e.target.value }; set({ doctors: next }); }}>
                      <option value="">Department…</option>
                      {(answers.departments ?? []).map((d) => (<option key={d} value={d}>{d}</option>))}
                    </Select>
                    <Select value={doc.minutes} onChange={(e) => { const next = [...answers.doctors!]; next[i] = { ...doc, minutes: Number(e.target.value) }; set({ doctors: next }); }}>
                      <option value={10}>10 min</option><option value={15}>15 min</option>
                      <option value={20}>20 min</option><option value={30}>30 min</option>
                    </Select>
                    <Input type="number" placeholder="Fee ₹" value={doc.fee || ""} onChange={(e) => { const next = [...answers.doctors!]; next[i] = { ...doc, fee: Number(e.target.value) }; set({ doctors: next }); }} />
                    <Button variant="ghost" size="sm" onClick={() => set({ doctors: answers.doctors!.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
                  </div>
                ))}
              </div>
              <Button
                className="mt-3"
                icon={<Plus size={14} />}
                onClick={() => set({ doctors: [...(answers.doctors ?? []), { name: "", department: answers.departments?.[0] ?? "", speciality: answers.departments?.[0] ?? "", minutes: 15, fee: 500 }] })}
              >
                Add a doctor
              </Button>
              {(answers.doctors ?? []).length === 0 && (
                <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
                  You can skip this and add doctors later — but the AI receptionist will have nothing to book into until
                  at least one exists.
                </p>
              )}
            </div>
          )}

          {/* -------------------------- 4 languages ------------------------- */}
          {step === 4 && (
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900"><Languages size={18} className="text-brand-600" /> How do your patients speak?</h2>
              <p className="mt-1 text-sm text-ink-500">
                The agent detects the language on the call and continues in it. Code-mixed speech is expected, not an error.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {(["mr", "hi", "en", "hinglish"] as LanguageCode[]).map((l) => {
                  const on = answers.languages?.includes(l);
                  return (
                    <button
                      key={l}
                      onClick={() => set({ languages: on ? answers.languages!.filter((x) => x !== l) : [...(answers.languages ?? []), l] })}
                      className={cx("rounded-full px-4 py-2 text-sm font-medium transition", on ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-200")}
                    >
                      {LANGUAGE_LABELS[l]}
                    </button>
                  );
                })}
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <Field label="Roughly how many patient calls a month?" hint="Used to size your voice minute pack">
                  <Select value={answers.monthlyCallVolume ?? ""} onChange={(e) => set({ monthlyCallVolume: e.target.value })}>
                    <option value="">Select…</option>
                    <option>Under 1,000</option><option>1,000 – 5,000</option>
                    <option>5,000 – 20,000</option><option>Over 20,000</option>
                  </Select>
                </Field>
                <div className="rounded-lg border border-ink-200 px-3">
                  <Toggle
                    label="Load sample patients"
                    description="Twelve synthetic patients and appointments so your dashboard is not empty while you evaluate"
                    checked={Boolean(answers.loadSampleData)}
                    onChange={(v) => set({ loadSampleData: v })}
                  />
                </div>
              </div>
            </div>
          )}

          {/* --------------------------- 5 features ------------------------- */}
          {step === 5 && (
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900"><Wand2 size={18} className="text-brand-600" /> Which modules should we unlock?</h2>
              <p className="mt-1 text-sm text-ink-500">
                Anything you leave off is hidden from your staff completely. You can unlock more at any time from Settings.
              </p>
              <div className="mt-5 space-y-5">
                {groups.map((g) => (
                  <div key={g}>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{g}</p>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {catalog.filter((f) => f.group === g).map((f) => {
                        const on = answers.features?.includes(f.key);
                        return (
                          <button
                            key={f.key}
                            onClick={() => set({ features: on ? answers.features!.filter((x) => x !== f.key) : [...(answers.features ?? []), f.key] })}
                            className={cx(
                              "rounded-xl border p-3 text-left transition",
                              on ? "border-brand-500 bg-brand-50" : "border-ink-200 hover:border-ink-300 hover:bg-ink-50",
                            )}
                          >
                            <div className="flex items-start gap-2">
                              <span className={cx("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded", on ? "bg-brand-600 text-white" : "bg-ink-200")}>
                                {on && <CheckCircle2 size={11} />}
                              </span>
                              <span>
                                <span className="block text-xs font-semibold text-ink-900">{f.label}</span>
                                <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-600">{f.blurb}</span>
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs text-ink-500">{answers.features?.length ?? 0} of {catalog.length} modules selected</p>
            </div>
          )}

          {/* ---------------------------- 6 storage ------------------------- */}
          {step === 6 && (
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900"><HardDrive size={18} className="text-brand-600" /> Where should recordings live?</h2>
              <p className="mt-1 text-sm text-ink-500">
                Call audio and export bundles are written to the storage you choose. You can change this and test the
                connection any time in Settings.
              </p>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <button
                  onClick={() => set({ storageDriver: "local" })}
                  className={cx("rounded-xl border p-4 text-left transition", answers.storageDriver === "local" ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500/30" : "border-ink-200 hover:bg-ink-50")}
                >
                  <HardDrive size={18} className="text-ink-500" />
                  <p className="mt-2 text-sm font-semibold text-ink-900">On our own server</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600">
                    A local encrypted volume on the machine running the platform. Nothing leaves your premises. Best for
                    hospitals with a data-residency or network policy.
                  </p>
                </button>
                <button
                  onClick={() => set({ storageDriver: "s3" })}
                  className={cx("rounded-xl border p-4 text-left transition", answers.storageDriver === "s3" ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500/30" : "border-ink-200 hover:bg-ink-50")}
                >
                  <Cloud size={18} className="text-ink-500" />
                  <p className="mt-2 text-sm font-semibold text-ink-900">Our own cloud bucket</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600">
                    Any S3-compatible bucket — AWS S3, MinIO, Cloudflare R2 or Wasabi. You keep the keys and the
                    lifecycle rules. We will ask for the credentials right after setup.
                  </p>
                </button>
              </div>
              <p className="mt-4 rounded-lg bg-ink-50 p-3 text-xs leading-relaxed text-ink-600">
                Either way, audio, transcripts and clinical summaries get separate retention periods — a summary stays
                useful for years, raw audio rarely needs to.
              </p>
            </div>
          )}

          {/* ------------------------ 7 voice + escalation ------------------- */}
          {step === 7 && (
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900"><Bot size={18} className="text-brand-600" /> Voice agent and critical escalation</h2>
              <p className="mt-1 text-sm text-ink-500">
                Rehearse on the built-in simulator, or connect Retell and ElevenLabs now. Either way, tell us which number
                a critical call should be handed to.
              </p>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <button
                  onClick={() => set({ voiceProvider: "simulator" })}
                  className={cx("rounded-xl border p-4 text-left transition", answers.voiceProvider === "simulator" ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500/30" : "border-ink-200 hover:bg-ink-50")}
                >
                  <p className="text-sm font-semibold text-ink-900">Built-in simulator</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600">
                    Full conversation, transcript, red-flag detection, recording and escalation — generated locally with
                    no vendor and no spend. Perfect for training staff and for the clinical sign-off meeting.
                  </p>
                  <Badge tone="green" className="mt-2">No keys needed</Badge>
                </button>
                <button
                  onClick={() => set({ voiceProvider: "retell" })}
                  className={cx("rounded-xl border p-4 text-left transition", answers.voiceProvider === "retell" ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500/30" : "border-ink-200 hover:bg-ink-50")}
                >
                  <p className="text-sm font-semibold text-ink-900">Retell + ElevenLabs</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600">
                    Real outbound and inbound calls on your own Retell account, with ElevenLabs voices. We will take your
                    keys on the next screen and test them live before anything is published.
                  </p>
                  <Badge tone="amber" className="mt-2">Your own API keys</Badge>
                </button>
              </div>

              <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50/50 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <AlertTriangle size={15} className="text-rose-600" /> Critical-situation main line
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink-700">
                  When a follow-up call hits a red flag, the platform stops the questionnaire and hands the live call
                  straight to this number, then opens an escalation with the SLA clock running.
                </p>
                <div className="mt-3 max-w-sm">
                  <Field label="Main line number">
                    <Input
                      placeholder="+91 20 4000 1099"
                      value={answers.mainLineNumber ?? ""}
                      onChange={(e) => set({ mainLineNumber: e.target.value })}
                    />
                  </Field>
                </div>
              </div>
            </div>
          )}

          {/* ---------------------------- 8 review -------------------------- */}
          {step === 8 && (
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900"><Rocket size={18} className="text-brand-600" /> Ready to provision</h2>
              <p className="mt-1 text-sm text-ink-500">We will create all of this now. Everything stays editable afterwards.</p>

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
                </div>
              )}

              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ["Hospital", answers.hospitalName ?? "—"],
                  ["Location", [answers.city, answers.state].filter(Boolean).join(", ") || "—"],
                  ["Branches", String((answers.branches?.length ?? 0) || 1)],
                  ["Departments", String(answers.departments?.length ?? 0)],
                  ["Doctors", String(answers.doctors?.length ?? 0)],
                  ["Languages", (answers.languages ?? []).map((l) => LANGUAGE_LABELS[l].split(" ")[0]).join(", ")],
                  ["Modules unlocked", String(answers.features?.length ?? 0)],
                  ["Recording storage", answers.storageDriver === "s3" ? "Your S3 bucket" : "Local encrypted volume"],
                  ["Voice", answers.voiceProvider === "retell" ? "Retell + ElevenLabs" : "Built-in simulator"],
                  ["Critical main line", answers.mainLineNumber || "not set"],
                  ["Sample data", answers.loadSampleData ? "Yes" : "No"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-ink-200 p-3">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400">{k}</p>
                    <p className="mt-0.5 text-sm text-ink-800">{v}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-lg bg-ink-50 p-3 text-xs leading-relaxed text-ink-600">
                Provisioning creates your facilities, departments, doctor calendars, a starter clinical protocol (as a
                draft, awaiting your clinical sign-off) and your AI agents — also as drafts. Nothing calls a patient
                until you publish an agent yourself.
              </div>
            </div>
          )}
        </Card>

        <div className="mt-5 flex items-center justify-between">
          <Button onClick={() => saveProgress(Math.max(0, step - 1))} disabled={step === 0 || provisioning} icon={<ArrowLeft size={15} />}>
            Back
          </Button>
          <div className="flex items-center gap-2">
            {step < STEPS.length - 1 && step > 0 && (
              <Button variant="ghost" onClick={() => saveProgress(step + 1)} disabled={provisioning}>Skip</Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button variant="primary" onClick={() => saveProgress(step + 1)} disabled={!canContinue} icon={<ArrowRight size={15} />}>
                Continue
              </Button>
            ) : (
              <Button variant="primary" onClick={finish} disabled={provisioning} icon={provisioning ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />}>
                {provisioning ? "Provisioning…" : "Create my workspace"}
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
