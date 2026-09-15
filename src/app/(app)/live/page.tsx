"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useOrgData, useStore, type ForwardResult } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { cx, duration, LANGUAGE_LABELS, LANGUAGE_SHORT } from "@/lib/utils";
import type { LanguageCode, Patient, TranscriptTurn } from "@/lib/types";
import {
  AlertTriangle, Bot, CheckCircle2, Languages, Loader2, Mic, MicOff, PhoneForwarded, PhoneOff, PhoneOutgoing, Radio,
  ShieldCheck, Siren, Sparkles, User, Wand2, Waves,
} from "lucide-react";

export default function LivePage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-500">Loading console…</p>}>
      <LiveInner />
    </Suspense>
  );
}

type Phase = "idle" | "dialing" | "connected" | "ended";

interface ScriptTurn extends TranscriptTurn {
  tool?: string;
  captures?: { field: string; value: string };
}

function buildScript(patient: Patient, agentType: "care" | "receptionist"): ScriptTurn[] {
  const first = patient.name.split(" ")[0];
  const L = patient.language;
  const t = (mr: string, hi: string, en: string) => (L === "mr" ? mr : L === "hi" ? hi : en);

  if (agentType === "receptionist") {
    return [
      { speaker: "system", text: "Inbound call answered · language detection running", atSecond: 0 },
      { speaker: "agent", text: t("नमस्कार, डेमोकेअर हॉस्पिटल. मी आपली कशी मदत करू?", "नमस्ते, डेमोकेयर अस्पताल। मैं आपकी कैसे मदद कर सकती हूँ?", "Good morning, DemoCare Hospital. How may I help you?"), translation: "Good morning, DemoCare Hospital. How may I help you?", atSecond: 2 },
      { speaker: "patient", text: t("मला डॉक्टरांची अपॉइंटमेंट हवी आहे.", "मुझे डॉक्टर से अपॉइंटमेंट चाहिए।", "I'd like to book an appointment."), translation: "I'd like to book an appointment.", atSecond: 7 },
      { speaker: "system", text: "Intent: BOOK_APPOINTMENT (confidence 0.96) · scope: administrative only", atSecond: 8, tool: "intent.classify" },
      { speaker: "agent", text: t("नक्की. कोणत्या विभागासाठी?", "ज़रूर। किस विभाग के लिए?", "Certainly. Which speciality do you need?"), translation: "Certainly. Which speciality do you need?", atSecond: 11 },
      { speaker: "patient", text: t("हृदयरोग तज्ञ.", "हृदय रोग विशेषज्ञ।", "Cardiology please."), translation: "Cardiology please.", atSecond: 15, captures: { field: "Speciality", value: "Cardiology" } },
      { speaker: "system", text: "availability.read(dept=Cardiology) → 6 slots in next 4 days", atSecond: 17, tool: "availability.read" },
      { speaker: "agent", text: t("गुरुवारी सकाळी ११:१५ किंवा शुक्रवारी दुपारी ४:३० उपलब्ध आहे.", "गुरुवार 11:15 या शुक्रवार 4:30 उपलब्ध है।", "Thursday 11:15 am or Friday 4:30 pm are available."), translation: "Thursday 11:15 am or Friday 4:30 pm are available.", atSecond: 20 },
      { speaker: "patient", text: t("गुरुवार चालेल.", "गुरुवार ठीक है।", "Thursday works."), translation: "Thursday works.", atSecond: 26, captures: { field: "Slot", value: "Thursday 11:15" } },
      { speaker: "system", text: "slot.hold(90s) → availability.recheck() → appointment.create() [idempotent]", atSecond: 28, tool: "appointment.create" },
      { speaker: "agent", text: t("झालं. तुमचा अपॉइंटमेंट क्रमांक DC-48213 आहे. व्हॉट्सअॅपवर पुष्टी पाठवली आहे.", "हो गया। अपॉइंटमेंट नंबर DC-48213 है। व्हाट्सएप पर पुष्टि भेज दी है।", "Booked. Your appointment ID is DC-48213 and I've sent a WhatsApp confirmation."), translation: "Booked. Appointment ID DC-48213, WhatsApp confirmation sent.", atSecond: 32, captures: { field: "Appointment ID", value: "DC-48213" } },
      { speaker: "patient", text: t("धन्यवाद.", "धन्यवाद।", "Thank you."), translation: "Thank you.", atSecond: 38 },
    ];
  }

  const isCardiac = patient.carePathway.toLowerCase().includes("cardiac");
  const redFlag = patient.risk === "red";

  return [
    { speaker: "system", text: `Outbound dial · consent verified (clinical calls: granted, v${patient.consent.version})`, atSecond: 0 },
    { speaker: "agent", text: t(`नमस्कार, मी डेमोकेअर हॉस्पिटलची सहाय्यक बोलत आहे. मी ${first} यांच्याशी बोलत आहे का?`, `नमस्ते, मैं डेमोकेयर अस्पताल से बोल रही हूँ। क्या ${first} जी से बात हो रही है?`, `Hello, this is the DemoCare Hospital assistant. Am I speaking with ${first}?`), translation: `Hello, this is DemoCare Hospital. Am I speaking with ${first}?`, atSecond: 2 },
    { speaker: "patient", text: t("हो, मीच बोलतोय.", "हाँ जी, बोलिए।", "Yes, speaking."), translation: "Yes, speaking.", atSecond: 7 },
    { speaker: "agent", text: t("सुरक्षिततेसाठी कृपया जन्मतारीख सांगाल का?", "सुरक्षा के लिए कृपया जन्मतिथि बताएँ।", "For verification, could you confirm your date of birth?"), translation: "For verification, please confirm your date of birth.", atSecond: 10 },
    { speaker: "patient", text: t("चौदा मार्च.", "चौदह मार्च।", "14th March."), translation: "14th March.", atSecond: 15 },
    { speaker: "system", text: "identity.verify(dob+name) → MATCH · clinical context unlocked (purpose-scoped)", atSecond: 17, tool: "identity.verify" },
    { speaker: "agent", text: t("धन्यवाद. डिस्चार्जनंतर तब्येत कशी आहे?", "धन्यवाद। डिस्चार्ज के बाद तबियत कैसी है?", "Thank you. How has your health been since discharge?"), translation: "How has your health been since discharge?", atSecond: 20 },
    {
      speaker: "patient",
      text: redFlag
        ? t("बरं वाटतंय, पण काल रात्री छातीत दुखत होतं.", "ठीक हूँ, पर कल रात सीने में दर्द हुआ।", "Better, but I had chest pain last night.")
        : t("बरं वाटतंय.", "ठीक हूँ।", "I'm feeling better."),
      translation: redFlag ? "Better, but I had chest pain last night." : "I'm feeling better.",
      atSecond: 26,
      flag: redFlag ? "red" : undefined,
      captures: { field: "General health", value: redFlag ? "Improving but new symptom" : "Improving" },
    },
    ...(redFlag
      ? ([
          { speaker: "system", text: `RED FLAG · protocol ${isCardiac ? "CARD-PD-v3.2" : "ORTH-PO-v2.1"} rule R1 matched — routine path suspended`, atSecond: 28, flag: "red" as const, tool: "protocol.evaluate" },
          { speaker: "agent", text: t("हे महत्त्वाचं आहे. दुखणं किती वेळ होतं?", "यह महत्वपूर्ण है। दर्द कितनी देर रहा?", "That is important. How long did the pain last?"), translation: "That is important. How long did the pain last?", atSecond: 31 },
          { speaker: "patient", text: t("साधारण दहा मिनिटं, आणि दम लागत होता.", "करीब दस मिनट, और साँस फूल रही थी।", "About ten minutes, and I was breathless."), translation: "About ten minutes, and I was breathless.", atSecond: 37, flag: "red" as const, captures: { field: "Chest pain", value: "Yes — 10 min, with breathlessness" } },
          { speaker: "agent", text: t("मी आत्ता तुमच्या डॉक्टरांच्या टीमला कळवते. कृपया फोन ठेवू नका.", "मैं अभी आपके डॉक्टर की टीम को सूचित कर रही हूँ। कृपया लाइन पर रहें।", "I'm informing your doctor's team right now. Please stay on the line."), translation: "I'm informing your doctor's team now. Please stay on the line.", atSecond: 42 },
          { speaker: "system", text: "escalation.create(level=RED, sla=15min) → oncall.notify() → warm_transfer.initiate()", atSecond: 46, flag: "red" as const, tool: "escalation.create" },
        ] as ScriptTurn[])
      : ([
          { speaker: "agent", text: t("सर्व औषधं वेळेवर घेत आहात का?", "क्या सभी दवाइयाँ समय पर ले रहे हैं?", "Are you taking all your medicines as prescribed?"), translation: "Are you taking all medicines as prescribed?", atSecond: 30 },
          { speaker: "patient", text: t("हो, पण काल रात्रीची एक डोस विसरलो.", "हाँ, पर कल रात की एक खुराक छूट गई।", "Yes, but I missed one dose last night."), translation: "Yes, but I missed one dose last night.", atSecond: 36, flag: "amber" as const, captures: { field: "Missed dose", value: "One evening dose" } },
          { speaker: "system", text: "protocol.evaluate → AMBER (adherence gap) · no dosage advice permitted", atSecond: 38, flag: "amber" as const, tool: "protocol.evaluate" },
          { speaker: "agent", text: t("नोंद घेतली. कोणताही नवीन त्रास जाणवतो का?", "नोट कर लिया। कोई नई शिकायत?", "Noted. Any new complaint?"), translation: "Noted. Any new complaint?", atSecond: 41 },
          { speaker: "patient", text: t("थोडी कमजोरी वाटते.", "थोड़ी कमज़ोरी लगती है।", "I feel a bit weak."), translation: "I feel a bit weak.", atSecond: 46, captures: { field: "New complaint", value: "Mild weakness" } },
          { speaker: "agent", text: t("मी हे तुमच्या नर्सला कळवते. पुढची अपॉइंटमेंट ठरवू का?", "मैं यह आपकी नर्स को बताऊँगी। अगली अपॉइंटमेंट तय करूँ?", "I'll pass this to your nurse. Shall I schedule your next appointment?"), translation: "I'll pass this to your nurse. Shall I book your next appointment?", atSecond: 50 },
          { speaker: "patient", text: t("हो, पुढच्या शनिवारी.", "हाँ, अगले शनिवार।", "Yes, next Saturday."), translation: "Yes, next Saturday.", atSecond: 56, captures: { field: "Appointment", value: "Requested — next Saturday" } },
          { speaker: "system", text: "task.create(queue=review, assignee=care_coordinator) · appointment.request()", atSecond: 59, tool: "task.create" },
        ] as ScriptTurn[])),
    { speaker: "agent", text: t("आमच्या सेवेला पाचपैकी किती गुण द्याल?", "हमारी सेवा को पाँच में से कितने अंक देंगे?", "How would you rate our service out of five?"), translation: "How would you rate our service out of five?", atSecond: redFlag ? 50 : 62 },
    { speaker: "patient", text: t("चार.", "चार।", "Four."), translation: "Four.", atSecond: redFlag ? 55 : 67, captures: { field: "Patient feedback", value: "4/5" } },
    { speaker: "system", text: "call.summarise() → structured extraction validated against schema", atSecond: redFlag ? 58 : 70, tool: "call.summarise" },
  ];
}

function LiveInner() {
  const sp = useSearchParams();
  const { can, notify, org, currentUser, startCall, finalizeCall, forwardCritical } = useStore();
  const d = useOrgData();

  const [patientId, setPatientId] = useState(sp.get("patient") ?? "");
  const [patientFilter, setPatientFilter] = useState("");
  const [agentType, setAgentType] = useState<"care" | "receptionist">("care");
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [turns, setTurns] = useState<ScriptTurn[]>([]);
  const [captured, setCaptured] = useState<Record<string, string>>({});
  const [tools, setTools] = useState<string[]>([]);
  const [risk, setRisk] = useState<"green" | "amber" | "red">("green");
  const [showTranslation, setShowTranslation] = useState(true);
  const [muted, setMuted] = useState(false);
  const [takenOver, setTakenOver] = useState(false);
  const [detectedLang, setDetectedLang] = useState<LanguageCode | null>(null);
  const [providerCallId, setProviderCallId] = useState<string>("");
  const [simulated, setSimulated] = useState(true);
  const [forwardResult, setForwardResult] = useState<ForwardResult | null>(null);
  const [forwarding, setForwarding] = useState(false);
  const forwardedRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const store = useStore();
  const escalationCfg = (store.settings.escalation ?? {}) as { mainLineNumber?: string; autoForwardOnRed?: boolean; transferMode?: string; slaMinutes?: number };
  const autoForward = escalationCfg.autoForwardOnRed !== false;

  const matchingPatients = useMemo(() => {
    const q = patientFilter.trim().toLowerCase();
    if (!q) return d.patients;
    /* Only match on phone when the query actually contains digits — an empty
       digit string is a substring of every number, which would match everyone. */
    const digits = q.replace(/\D/g, "");
    return d.patients.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.mrn.toLowerCase().includes(q) ||
        (digits.length >= 3 && p.phone.includes(digits)),
    );
  }, [d.patients, patientFilter]);

  const patient = d.patients.find((p) => p.id === patientId) ?? null;
  const script = useMemo(() => (patient ? buildScript(patient, agentType) : []), [patient, agentType]);
  const agent = d.agents.find((a) => a.type === agentType && a.status === "published");
  const patientDeptCode = d.departments.find((x) => x.id === patient?.departmentId)?.code;
  const protocol =
    d.protocols.find(
      (p) => d.departments.find((x) => x.id === p.departmentId)?.code === patientDeptCode && p.status === "approved",
    ) ?? d.protocols.find((p) => p.id === agent?.protocolId);

  useEffect(() => {
    if (!patientId && d.patients.length) {
      const red = d.patients.find((p) => p.risk === "red" && p.consent.clinicalCalls);
      setPatientId((red ?? d.patients[0]).id);
    }
  }, [d.patients, patientId]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => () => stop(), [stop]);

  async function start() {
    if (!patient) return;
    if (agentType === "care" && !patient.consent.clinicalCalls) {
      notify("Blocked by the consent engine — this patient has withdrawn clinical call consent");
      return;
    }
    setPhase("dialing");
    setTurns([]); setCaptured({}); setTools([]); setRisk("green"); setElapsed(0);
    setTakenOver(false); setMuted(false); setDetectedLang(null); setForwardResult(null);
    forwardedRef.current = false;

    const placed = await startCall(patient.id, agentType);
    if (!placed) {
      setPhase("idle");
      return;
    }
    setProviderCallId(placed.providerCallId);
    setSimulated(placed.simulated);
    if (placed.detail) notify(placed.detail);

    setPhase("connected");
    setDetectedLang(patient.language);
    let t = 0;
    timerRef.current = setInterval(() => {
      t += 1;
      setElapsed(t);
      const due = script.filter((s) => s.atSecond <= t);
      setTurns((prev) => (due.length > prev.length ? due : prev));
      const newest = script.find((s) => s.atSecond === t);
      if (newest) {
        if (newest.flag === "red") {
          setRisk("red");
          if (!forwardedRef.current && autoForward) {
            forwardedRef.current = true;
            void runForward(newest.text);
          }
        } else if (newest.flag === "amber") setRisk((r) => (r === "red" ? r : "amber"));
        if (newest.captures) setCaptured((c) => ({ ...c, [newest.captures!.field]: newest.captures!.value }));
        if (newest.tool) setTools((x) => [...x, newest.tool!]);
      }
      const last = script[script.length - 1];
      if (last && t > last.atSecond + 3) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        setPhase("ended");
      }
    }, 1000);
  }

  /** Critical-situation handover: the live call goes to the hospital's main line. */
  async function runForward(trigger: string) {
    if (!patient) return;
    setForwarding(true);
    const res = await forwardCritical({
      patientId: patient.id,
      providerCallId,
      trigger: trigger.slice(0, 140),
      detail: `Red flag during a ${agentType} call. Protocol ${protocol?.version ?? "—"}.`,
    });
    setForwarding(false);
    if (res) {
      setForwardResult(res);
      setTakenOver(true);
      setTools((x) => [...x, "escalation.forward"]);
      notify(
        res.connectedTo
          ? `Call forwarded to ${res.connectedTo} — escalation opened, SLA ${res.slaMinutes} min`
          : "Transfer not accepted — a high-priority callback task has been raised",
      );
    }
  }

  function endCall(reason: string) {
    stop();
    setPhase("ended");
    notify(reason);
  }

  async function saveCall() {
    if (!patient) return;
    setSaving(true);
    const saved = await finalizeCall(patient.id, agentType, {
      durationSeconds: elapsed,
      risk,
      transcript: turns,
      structured: {
        ...captured,
        "Workflow outcome": risk === "red" ? "RED — urgent escalation" : risk === "amber" ? "AMBER — clinician review" : "GREEN — routine",
        ...(forwardResult?.connectedTo ? { "Forwarded to": forwardResult.connectedTo } : {}),
      },
      summary: `${agentType === "care" ? "Follow-up" : "Front desk"} call with ${patient.name}. ${Object.entries(captured).map(([k, v]) => `${k}: ${v}`).join("; ")}.${forwardResult?.connectedTo ? ` Live call forwarded to ${forwardResult.connectedTo}.` : ""}`,
      outcome: risk === "red" ? "Red flag — forwarded to main line" : risk === "amber" ? "Review required" : "Completed — routine",
      status: takenOver ? "transferred" : "completed",
      providerCallId,
    });
    setSaving(false);
    if (saved) {
      notify(
        patient.consent.recording
          ? "Call saved with structured summary, recording stored and audit trail written"
          : "Call saved with structured summary — no recording (patient consent not granted)",
      );
      setPhase("idle");
      setTurns([]);
      setForwardResult(null);
    }
  }

  if (!can("calls.view")) return <Denied />;

  const protocolProgress = protocol
    ? protocol.questions.map((q) => {
        const key = Object.keys(captured).find((k) => q.text.en.toLowerCase().includes(k.toLowerCase().split(" ")[0]));
        return { q: q.text.en, answered: Boolean(key), answer: key ? captured[key] : null };
      })
    : [];

  return (
    <>
      <PageHeader
        title="Live call console"
        subtitle="Watch the AI agent work in real time — transcript, protocol evaluation, tool calls and human take-over"
        actions={
          phase === "idle" ? (
            can("calls.initiate") && (
              <Button variant="primary" icon={<PhoneOutgoing size={15} />} onClick={start} disabled={!patient}>
                Start AI call
              </Button>
            )
          ) : phase === "ended" ? (
            <>
              <Button onClick={() => { setPhase("idle"); setTurns([]); }}>Discard</Button>
              <Button variant="primary" icon={<CheckCircle2 size={15} />} onClick={saveCall} disabled={saving}>{saving ? "Saving…" : "Save call & summary"}</Button>
            </>
          ) : (
            <Button variant="danger" icon={<PhoneOff size={15} />} onClick={() => endCall("Call ended by staff")}>End call</Button>
          )
        }
      />

      <div className="grid gap-4 xl:grid-cols-[320px_1fr_310px]">
        {/* setup / call state */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Call setup" icon={<Bot size={15} />} />
            <div className="space-y-3">
              {/*
                This was a plain dropdown capped at 40 patients with no search,
                so in any real hospital most patients simply could not be
                called. It now filters the whole loaded register as you type.
              */}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-600">Patient</span>
                {phase === "idle" && (
                  <Input
                    className="mb-1.5"
                    placeholder="Filter by name, MRN or phone…"
                    value={patientFilter}
                    onChange={(e) => setPatientFilter(e.target.value)}
                  />
                )}
                <Select value={patientId} onChange={(e) => setPatientId(e.target.value)} disabled={phase !== "idle"}>
                  {matchingPatients.slice(0, 200).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.mrn} {p.risk === "red" ? "(red)" : ""}
                    </option>
                  ))}
                  {!matchingPatients.length && <option value="">No patient matches that</option>}
                </Select>
                <span className="mt-1 block text-[11px] text-ink-400">
                  {matchingPatients.length > 200
                    ? `${matchingPatients.length} match — showing the first 200, keep typing to narrow`
                    : `${matchingPatients.length} of ${d.patients.length} patients`}
                </span>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-600">Agent</span>
                <Select value={agentType} onChange={(e) => setAgentType(e.target.value as "care" | "receptionist")} disabled={phase !== "idle"}>
                  <option value="care">Care follow-up agent (protocol-driven)</option>
                  <option value="receptionist">Front desk agent (administrative)</option>
                </Select>
              </label>
              {patient && (
                <div className="rounded-lg bg-ink-50 p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <Avatar name={patient.name} size={30} hue={patient.gender === "F" ? 320 : 205} />
                    <div className="min-w-0">
                      <Link href={`/patients/${patient.id}`} className="block truncate font-medium text-ink-900 hover:text-brand-700">{patient.name}</Link>
                      <p className="truncate text-ink-500">{patient.mrn} · {LANGUAGE_LABELS[patient.language]}</p>
                    </div>
                  </div>
                  <div className="mt-2 space-y-1 text-[11px]">
                    <p className="flex justify-between"><span className="text-ink-500">Consent (clinical calls)</span><Badge tone={patient.consent.clinicalCalls ? "green" : "red"}>{patient.consent.clinicalCalls ? "granted" : "withdrawn"}</Badge></p>
                    <p className="flex justify-between"><span className="text-ink-500">Recording</span><Badge tone={patient.consent.recording ? "green" : "neutral"}>{patient.consent.recording ? "permitted" : "off"}</Badge></p>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* live status */}
          <Card className={cx(phase === "connected" && risk === "red" && "border-rose-300 ring-2 ring-rose-100")}>
            <CardHeader title="Call state" icon={<Radio size={15} />} />
            {phase === "idle" && <p className="text-sm text-ink-500">No active call. Start one to see the agent work.</p>}
            {phase === "dialing" && (
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
                <p className="text-sm text-ink-700">Dialing {patient?.phone}…</p>
              </div>
            )}
            {(phase === "connected" || phase === "ended") && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-medium text-ink-900">
                    <span className={cx("h-2.5 w-2.5 rounded-full", phase === "connected" ? "bg-emerald-500 pulse-ring" : "bg-ink-300")} />
                    {phase === "connected" ? (takenOver ? "Human on the line" : "AI agent speaking") : "Call ended"}
                  </span>
                  <span className="font-semibold tabular-nums text-ink-900">{duration(elapsed)}</span>
                </div>

                <div className="flex h-10 items-end justify-center gap-[3px] rounded-lg bg-ink-900 px-3 py-2">
                  {Array.from({ length: 24 }).map((_, i) => (
                    <span
                      key={i}
                      className={cx("wave-bar w-[3px] rounded-full", risk === "red" ? "bg-rose-400" : takenOver ? "bg-sky-400" : "bg-brand-400")}
                      style={{ height: `${30 + ((i * 37) % 60)}%`, animationDelay: `${(i % 8) * 0.11}s`, animationPlayState: phase === "connected" ? "running" : "paused" }}
                    />
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-ink-200 p-2">
                    <p className="text-[10px] text-ink-400">Detected language</p>
                    <p className="mt-0.5 flex items-center gap-1 font-medium text-ink-900">
                      <Languages size={12} /> {detectedLang ? LANGUAGE_SHORT[detectedLang] : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-ink-200 p-2">
                    <p className="text-[10px] text-ink-400">Provider</p>
                    <p className="mt-0.5 font-medium text-ink-900">{simulated ? "Simulator" : "Retell (live)"}</p>
                  </div>
                  <div className="rounded-lg border border-ink-200 p-2">
                    <p className="text-[10px] text-ink-400">Risk state</p>
                    <p className={cx("mt-0.5 font-medium", risk === "red" ? "text-rose-600" : risk === "amber" ? "text-amber-600" : "text-emerald-600")}>
                      {risk === "red" ? "RED — escalate" : risk === "amber" ? "AMBER — review" : "GREEN — routine"}
                    </p>
                  </div>
                </div>

                {phase === "connected" && (
                  <div className="grid grid-cols-2 gap-2">
                    {/*
                      In-call audio control — muting the line, taking the call
                      over from the agent, whispering to it mid-turn — has to be
                      driven by the telephony provider. Nothing here can do that
                      on a live Retell or ElevenLabs call, so on a live call
                      these are disabled and say why, rather than showing a
                      toast that makes staff believe the patient cannot hear
                      them. On the simulator they steer the simulated call, and
                      whatever they change is written into the transcript that
                      gets saved.
                    */}
                    <Button
                      size="sm"
                      icon={muted ? <MicOff size={13} /> : <Mic size={13} />}
                      disabled={!simulated}
                      title={simulated ? "Mute the simulated line" : "Live audio control is handled by the telephony provider and is not connected"}
                      onClick={() => {
                        const next = !muted;
                        setMuted(next);
                        setTurns((t) => [...t, { speaker: "system", text: next ? "Staff muted the line" : "Staff unmuted the line", atSecond: elapsed }]);
                        notify(next ? "Simulated line muted" : "Simulated line unmuted");
                      }}
                    >
                      {muted ? "Unmute" : "Mute"}
                    </Button>
                    {can("calls.takeover") && (
                      <Button
                        size="sm"
                        variant={takenOver ? "success" : "secondary"}
                        icon={<User size={13} />}
                        onClick={() => {
                          setTakenOver(true);
                          setTurns((t) => [...t, { speaker: "system", text: `${currentUser?.name ?? "Staff"} took the call over from the agent`, atSecond: elapsed }]);
                          notify("Recorded in the transcript — the agent has stepped back");
                        }}
                        disabled={takenOver || !simulated}
                        title={simulated ? "Take over the simulated call" : "Transferring a live call to a human is handled by the telephony provider and is not connected"}
                      >
                        {takenOver ? "You're live" : "Take over"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      icon={<Wand2 size={13} />}
                      disabled={!simulated}
                      title={simulated ? "Add a note the agent should work in" : "Whispering to a live agent is not connected"}
                      onClick={() => {
                        const note = window.prompt("What should the agent work into its next turn?")?.trim();
                        if (!note) return;
                        setTurns((t) => [...t, { speaker: "staff", text: `Whisper from ${currentUser?.name ?? "staff"}: ${note}`, atSecond: elapsed }]);
                        notify("Whisper added to the transcript");
                      }}
                    >
                      Whisper
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      icon={forwarding ? <Loader2 size={13} className="animate-spin" /> : <PhoneForwarded size={13} />}
                      onClick={() => runForward("Manual escalation by staff during the call")}
                      disabled={forwarding || Boolean(forwardResult)}
                    >
                      {forwardResult ? "Forwarded" : forwarding ? "Forwarding…" : "Forward"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Tool calls" subtitle="Every action the agent is allowed to take" icon={<Sparkles size={15} />} />
            {tools.length === 0 ? (
              <p className="text-xs text-ink-400">No tools called yet.</p>
            ) : (
              <div className="space-y-1">
                {tools.map((t, i) => (
                  <p key={i} className="rounded bg-ink-900 px-2 py-1 font-mono text-[11px] text-brand-300">{t}()</p>
                ))}
              </div>
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-ink-400">
              Anything outside this allow-list — changing a dose, giving a diagnosis, reading unrelated records — is not
              callable by the agent at all.
            </p>
          </Card>
        </div>

        {/* transcript */}
        <Card padded={false} className="flex min-h-[620px] flex-col">
          <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-ink-900">Live transcript</h3>
              <p className="text-xs text-ink-500">{agent?.name ?? "Agent"} · {agent?.voice ?? "voice"} · {org?.shortName}</p>
            </div>
            <label className="flex items-center gap-2 text-xs text-ink-500">
              <input type="checkbox" checked={showTranslation} onChange={(e) => setShowTranslation(e.target.checked)} className="accent-brand-600" />
              English translation
            </label>
          </div>

          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-4">
            {turns.length === 0 && (
              <EmptyState
                icon={<Waves size={24} />}
                title={phase === "idle" ? "Start a call to see the live transcript" : "Connecting…"}
                hint="Every turn is timestamped, language-tagged and linked to the protocol rule that evaluated it."
              />
            )}
            {turns.map((t, i) => {
              if (t.speaker === "system") {
                return (
                  <div key={i} className={cx("animate-fade-up mx-auto max-w-[92%] rounded-lg px-3 py-2 text-[11px] font-medium", t.flag === "red" ? "bg-rose-50 text-rose-800 ring-1 ring-rose-200" : "bg-ink-100 text-ink-600")}>
                    <span className="mr-1.5 font-mono text-[10px] text-ink-400">{String(t.atSecond).padStart(2, "0")}s</span>
                    {t.flag === "red" && <Siren size={11} className="mr-1 inline" />}
                    {t.text}
                  </div>
                );
              }
              const isAgent = t.speaker === "agent";
              return (
                <div key={i} className={cx("animate-fade-up flex gap-2.5", isAgent ? "" : "flex-row-reverse")}>
                  <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-full text-white", isAgent ? (takenOver ? "bg-sky-600" : "bg-brand-600") : "bg-ink-400")}>
                    {isAgent ? (takenOver ? <User size={13} /> : <Bot size={13} />) : <User size={13} />}
                  </span>
                  <div className={cx("max-w-[78%] rounded-2xl px-3.5 py-2.5", isAgent ? "rounded-tl-sm bg-brand-50 text-ink-900" : "rounded-tr-sm bg-ink-100 text-ink-900", t.flag === "red" && "ring-2 ring-rose-300")}>
                    <p className="text-sm leading-relaxed">{t.text}</p>
                    {showTranslation && t.translation && t.translation !== t.text && (
                      <p className="mt-1 border-t border-black/5 pt-1 text-[11px] italic text-ink-500">{t.translation}</p>
                    )}
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-400">
                      <span>{String(t.atSecond).padStart(2, "0")}s</span>
                      {t.flag && (
                        <span className={cx("rounded-full px-1.5 font-semibold", t.flag === "red" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700")}>
                          {t.flag.toUpperCase()} FLAG
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {phase === "ended" && (
            <div className="border-t border-ink-200 bg-ink-50 p-4">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                <CheckCircle2 size={15} className="text-emerald-600" /> Post-call structured summary
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {Object.entries(captured).map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 text-xs ring-1 ring-ink-200">
                    <span className="text-ink-500">{k}</span>
                    <span className="text-right font-medium text-ink-900">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* protocol + context */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Purpose-limited context" subtitle="Only what this call needs" icon={<ShieldCheck size={15} />} />
            {patient ? (
              <div className="space-y-1.5 text-xs">
                {[
                  ["Preferred name", patient.name.split(" ")[0]],
                  ["Language", LANGUAGE_LABELS[patient.language]],
                  ["Department", d.departments.find((x) => x.id === patient.departmentId)?.name ?? ""],
                  ["Care pathway", patient.carePathway],
                  ["Approved questionnaire", protocol?.version ?? "—"],
                  ["Medication checklist", `${patient.medications.length} items`],
                ].map(([k, v]) => (
                  <p key={k} className="flex justify-between gap-2">
                    <span className="text-ink-500">{k}</span>
                    <span className="text-right font-medium text-ink-800">{v}</span>
                  </p>
                ))}
                <p className="mt-2 rounded-lg bg-ink-50 p-2 text-[10px] leading-relaxed text-ink-500">
                  The agent cannot see lab reports, unrelated diagnoses or prescription history — the context compiler
                  retrieves only fields approved for this purpose.
                </p>
              </div>
            ) : (
              <p className="text-xs text-ink-400">Select a patient.</p>
            )}
          </Card>

          {protocol && agentType === "care" && (
            <Card>
              <CardHeader title="Protocol checklist" subtitle={`${protocol.name} · ${protocol.version}`} icon={<CheckCircle2 size={15} />} />
              <div className="space-y-1.5">
                {protocol.questions.map((q, i) => {
                  const done = protocolProgress[i]?.answered;
                  return (
                    <div key={q.id} className={cx("flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs", done ? "border-emerald-200 bg-emerald-50" : "border-ink-200")}>
                      <span className={cx("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white", done ? "bg-emerald-500" : "bg-ink-300")}>
                        {done ? "✓" : i + 1}
                      </span>
                      <span className="flex-1">
                        <span className="block text-ink-700">{q.text.en}</span>
                        {q.redIf && <span className="mt-0.5 block text-[10px] text-rose-500">red if: {q.redIf}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {forwardResult && (
            <Card className="border-rose-300 bg-rose-50/60">
              <CardHeader
                title={forwardResult.connectedTo ? "Forwarded to the main line" : "Transfer not accepted"}
                subtitle={`${forwardResult.transferMode} transfer · SLA ${forwardResult.slaMinutes} min${forwardResult.afterHours ? " · after hours route" : ""}`}
                icon={<PhoneForwarded size={15} />}
              />
              {forwardResult.connectedTo && (
                <p className="mb-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-ink-900 ring-1 ring-rose-200">
                  {forwardResult.connectedTo}
                </p>
              )}
              <div className="space-y-1.5">
                {forwardResult.steps.map((st, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px]">
                    <span className={cx("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-white", st.ok ? "bg-emerald-500" : "bg-rose-500")}>
                      {st.ok ? <CheckCircle2 size={10} /> : "!"}
                    </span>
                    <span>
                      <span className="block font-medium text-ink-800">{st.step}</span>
                      <span className="block text-ink-500">{st.detail}</span>
                    </span>
                  </div>
                ))}
              </div>
              <Link href="/escalations">
                <Button size="sm" variant="danger" className="mt-3 w-full">Open the escalation</Button>
              </Link>
            </Card>
          )}

          {risk !== "green" && (
            <Card className={risk === "red" ? "border-rose-300 bg-rose-50/50" : "border-amber-300 bg-amber-50/50"}>
              <CardHeader
                title={risk === "red" ? "Red flag triggered" : "Review required"}
                subtitle={risk === "red" ? `SLA ${protocol?.slaMinutes ?? 15} minutes` : "Non-urgent clinician review"}
                icon={<AlertTriangle size={15} />}
              />
              <p className="text-xs leading-relaxed text-ink-700">
                {risk === "red"
                  ? `Routine flow suspended. High-priority event created, ${protocol?.escalationTarget ?? "the on-call team"} alerted, and a warm transfer attempted. Acknowledgement is tracked and audited.`
                  : "A review task has been created for the care coordinator with the structured summary attached. The patient's routine pathway continues."}
              </p>
              <Link href="/escalations">
                <Button size="sm" className="mt-3" variant={risk === "red" ? "danger" : "secondary"}>Open escalation queue</Button>
              </Link>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
