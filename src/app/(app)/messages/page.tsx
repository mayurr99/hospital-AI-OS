"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useOrgData, useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, StatTile } from "@/components/ui";
import { cx, fmtTime, relative } from "@/lib/utils";
import { Bot, CheckCheck, MessageSquare, Send, ShieldCheck, Sparkles, User } from "lucide-react";

export default function MessagesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-500">Loading inbox…</p>}>
      <MessagesInner />
    </Suspense>
  );
}

const QUICK_REPLIES = [
  "Your report is ready. I've sent a secure link to your registered number.",
  "Your appointment is confirmed. Please arrive 15 minutes early with your previous reports.",
  "I've passed your question to the doctor's team — a clinician will call you back today.",
  "तुमची अपॉइंटमेंट निश्चित झाली आहे. कृपया वेळेत या.",
];

function MessagesInner() {
  const sp = useSearchParams();
  const { can, sendMessage, notify, audit } = useStore();
  const d = useOrgData();
  const [activeId, setActiveId] = useState<string | null>(sp.get("thread"));
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  const active = d.threads.find((t) => t.id === activeId) ?? d.threads[0] ?? null;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [active?.messages.length, activeId]);

  if (!can("messaging.use")) return <Denied />;

  const unread = d.threads.reduce((s, t) => s + t.unread, 0);
  const aiHandled = d.threads.filter((t) => t.aiHandling).length;

  function send() {
    if (!draft.trim() || !active) return;
    sendMessage(active.id, draft.trim(), "staff");
    audit("message.sent", `${d.patients.find((p) => p.id === active.patientId)?.name} via WhatsApp`);
    setDraft("");
    notify("Message sent");
  }

  return (
    <>
      <PageHeader
        title="WhatsApp / SMS inbox"
        subtitle="Two-way patient messaging — the AI handles routine threads and hands over the moment a clinician is needed"
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open threads" value={d.threads.length} icon={<MessageSquare size={15} />} tone="brand" />
        <StatTile label="Unread" value={unread} tone={unread ? "amber" : "green"} icon={<MessageSquare size={15} />} />
        <StatTile label="Handled by AI" value={aiHandled} sub={`${d.threads.length - aiHandled} with staff`} icon={<Bot size={15} />} />
        <StatTile label="Consented for WhatsApp" value={d.patients.filter((p) => p.consent.whatsapp).length} sub={`of ${d.patients.length} patients`} icon={<ShieldCheck size={15} />} tone="green" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card padded={false} className="max-h-[640px] overflow-y-auto">
          <div className="border-b border-ink-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-ink-900">Conversations</h3>
          </div>
          {d.threads.length === 0 && <div className="p-4"><EmptyState title="No conversations" /></div>}
          {d.threads.map((t) => {
            const p = d.patients.find((x) => x.id === t.patientId);
            const last = t.messages[t.messages.length - 1];
            return (
              <button
                key={t.id}
                onClick={() => setActiveId(t.id)}
                className={cx("flex w-full items-start gap-2.5 border-b border-ink-100 px-3 py-2.5 text-left transition", active?.id === t.id ? "bg-brand-50" : "hover:bg-ink-50")}
              >
                <Avatar name={p?.name ?? "?"} size={34} hue={p?.gender === "F" ? 320 : 205} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-ink-900">{p?.name}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-ink-400">{relative(t.lastAt)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink-500">{last?.body}</p>
                  <div className="mt-1 flex items-center gap-1">
                    {t.aiHandling ? <Badge tone="brand"><Bot size={9} /> AI</Badge> : <Badge tone="blue"><User size={9} /> staff</Badge>}
                    {t.unread > 0 && <Badge tone="red">{t.unread}</Badge>}
                  </div>
                </div>
              </button>
            );
          })}
        </Card>

        <Card padded={false} className="flex h-[640px] flex-col">
          {!active ? (
            <div className="grid flex-1 place-items-center"><EmptyState title="Select a conversation" /></div>
          ) : (
            <>
              {(() => {
                const p = d.patients.find((x) => x.id === active.patientId);
                return (
                  <div className="flex items-center gap-3 border-b border-ink-200 px-4 py-3">
                    <Avatar name={p?.name ?? "?"} size={36} hue={p?.gender === "F" ? 320 : 205} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/patients/${p?.id}`} className="block truncate text-sm font-semibold text-ink-900 hover:text-brand-700">
                        {p?.name}
                      </Link>
                      <p className="truncate text-xs text-ink-500">{p?.phone} · {p?.mrn} · {p?.carePathway}</p>
                    </div>
                    {active.aiHandling ? (
                      <Badge tone="brand"><Bot size={10} /> AI handling</Badge>
                    ) : (
                      <Badge tone="blue"><User size={10} /> staff handling</Badge>
                    )}
                  </div>
                );
              })()}

              <div ref={scroller} className="flex-1 space-y-2.5 overflow-y-auto bg-ink-50/50 p-4">
                {active.messages.map((m) => {
                  const out = m.direction === "out";
                  return (
                    <div key={m.id} className={cx("flex", out ? "justify-end" : "justify-start")}>
                      <div className={cx("max-w-[72%] rounded-2xl px-3.5 py-2 text-sm shadow-sm", out ? "rounded-br-sm bg-brand-600 text-white" : "rounded-bl-sm bg-white text-ink-900")}>
                        <p className="leading-relaxed">{m.body}</p>
                        <div className={cx("mt-1 flex items-center gap-1 text-[10px]", out ? "text-brand-100" : "text-ink-400")}>
                          <span>{fmtTime(m.at)}</span>
                          {out && (
                            <>
                              <span>·</span>
                              <span className="flex items-center gap-0.5">
                                {m.handledBy === "ai" ? <Bot size={9} /> : <User size={9} />}
                                {m.handledBy === "ai" ? "AI" : "staff"}
                              </span>
                              <CheckCheck size={11} />
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-ink-200 p-3">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {QUICK_REPLIES.map((r) => (
                    <button key={r} onClick={() => setDraft(r)} className="rounded-full bg-ink-100 px-2.5 py-1 text-[11px] text-ink-600 transition hover:bg-ink-200">
                      <Sparkles size={9} className="mr-1 inline" />
                      {r.length > 46 ? r.slice(0, 46) + "…" : r}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send()}
                    placeholder="Type a reply — the AI stops auto-responding on this thread once you do…"
                  />
                  <Button variant="primary" icon={<Send size={15} />} onClick={send} disabled={!draft.trim()}>Send</Button>
                </div>
                <p className="mt-1.5 text-[10px] text-ink-400">
                  Clinical advice is never auto-generated here. Dosage and diagnosis questions are routed to a clinician.
                </p>
              </div>
            </>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Message governance" icon={<ShieldCheck size={16} />} />
        <div className="grid gap-3 text-xs leading-relaxed text-ink-600 md:grid-cols-4">
          {[
            ["Consent-gated", "Only patients who have granted WhatsApp permission receive messages, and clinical and promotional permissions are tracked separately."],
            ["Template-bound", "Outbound business-initiated messages use approved templates; free text is reserved for replies inside the service window."],
            ["No clinical advice", "The AI answers logistics, reports and appointments. A dosage or symptom question triggers a clinician handover, not an answer."],
            ["Fully audited", "Every message — AI or human — is attributed, timestamped and retained under the hospital's retention policy."],
          ].map(([t, s]) => (
            <div key={t} className="rounded-lg border border-ink-200 p-3">
              <p className="mb-1 text-xs font-semibold text-ink-900">{t}</p>
              <p>{s}</p>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
