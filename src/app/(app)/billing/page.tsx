"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { useSticky } from "@/lib/sticky";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, Input, Modal, PageHeader, Select, StatTile, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { downloadCsv, fmtDate, inr, relative } from "@/lib/utils";
import type { Invoice } from "@/lib/types";
import { Banknote, CreditCard, Download, FileText, IndianRupee, Receipt, Send, ShieldCheck, Smartphone } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type TabKey = "all" | "outstanding" | "insurance" | "paid";

const total = (i: Invoice) => i.lines.reduce((s, l) => s + l.qty * l.rate, 0) - i.discount;

export default function BillingPage() {
  const { can, updateInvoice, notify, audit } = useStore();
  const d = useOrgData();
  const [tab, setTab] = useSticky<TabKey>("billing.tab", "all");
  const [open, setOpen] = useState<Invoice | null>(null);
  const [payMode, setPayMode] = useState<"upi" | "card" | "cash" | "netbanking">("upi");
  const [payAmount, setPayAmount] = useState(0);

  const rows = d.invoices.filter((i) => {
    if (tab === "outstanding") return i.status === "issued" || i.status === "overdue" || i.status === "part_paid";
    if (tab === "insurance") return i.status === "insurance_pending" || i.payer === "insurance";
    if (tab === "paid") return i.status === "paid";
    return true;
  });

  const billed = d.invoices.reduce((s, i) => s + total(i), 0);
  const collected = d.invoices.reduce((s, i) => s + i.paid, 0);
  const outstanding = billed - collected;
  const overdue = d.invoices.filter((i) => i.status === "overdue");

  const mix = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of d.invoices) for (const l of i.lines) m[l.category] = (m[l.category] ?? 0) + l.qty * l.rate;
    return Object.entries(m).map(([name, value]) => ({ name, value: Math.round(value) }));
  }, [d.invoices]);

  if (!can("billing.manage")) return <Denied />;

  return (
    <>
      <PageHeader
        title="Billing & invoices"
        subtitle="Patient accounts, insurance status, collections and AI-assisted payment follow-up"
        actions={
          can("data.export") && (
            <Button
              icon={<Download size={15} />}
              onClick={() => {
                audit("export.generated", `Billing report — ${rows.length} invoices`, "warning");
                downloadCsv("invoices.csv", rows.map((i) => ({
                  Invoice: i.number, Patient: d.patients.find((p) => p.id === i.patientId)?.name ?? "",
                  Issued: fmtDate(i.issuedAt), Payer: i.payer, Insurer: i.insurer ?? "",
                  Total: total(i), Paid: i.paid, Outstanding: total(i) - i.paid, Status: i.status,
                })));
                notify("Billing export generated");
              }}
            >
              Export
            </Button>
          )
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Billed" value={inr(billed, true)} sub={`${d.invoices.length} invoices`} icon={<Receipt size={15} />} tone="brand" />
        <StatTile label="Collected" value={inr(collected, true)} sub={`${Math.round((collected / Math.max(1, billed)) * 100)}% of billed`} icon={<Banknote size={15} />} tone="green" />
        <StatTile label="Outstanding" value={inr(outstanding, true)} icon={<IndianRupee size={15} />} tone="amber" />
        <StatTile label="Overdue invoices" value={overdue.length} sub={inr(overdue.reduce((s, i) => s + total(i) - i.paid, 0), true)} icon={<FileText size={15} />} tone={overdue.length ? "red" : "green"} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Revenue mix by category" icon={<IndianRupee size={16} />} />
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mix} margin={{ left: -12, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 100000)}L`} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} formatter={(v) => inr(Number(v))} cursor={{ fill: "#f1f5f9" }} />
                <Bar dataKey="value" fill="#0d9488" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="AI payment follow-up" subtitle="Polite, multilingual, never aggressive" icon={<Smartphone size={16} />} />
          <div className="space-y-2 text-xs">
            {[
              ["Day 0", "Invoice and secure payment link sent on WhatsApp in the patient's language."],
              ["Day 3", "Gentle reminder message with the outstanding amount and payment options."],
              ["Day 7", "AI call offering to explain the bill, resend the link or connect to the billing desk."],
              ["Day 14", "Handed to a human in the billing queue — the AI stops."],
            ].map(([t, s]) => (
              <div key={t} className="rounded-lg border border-ink-200 p-2.5">
                <p className="font-semibold text-brand-700">{t}</p>
                <p className="mt-0.5 leading-relaxed text-ink-600">{s}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 rounded-lg bg-ink-50 p-2.5 text-[11px] leading-relaxed text-ink-500">
            <ShieldCheck size={11} className="mr-1 inline" />
            Payment reminders run under the patient&apos;s administrative-communication permission and are kept separate from
            clinical follow-up consent.
          </p>
        </Card>
      </div>

      <Card padded={false}>
        <div className="border-b border-ink-200 px-4 pt-2">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: "all", label: "All invoices", count: d.invoices.length },
              { key: "outstanding", label: "Outstanding", count: d.invoices.filter((i) => i.status === "issued" || i.status === "overdue" || i.status === "part_paid").length },
              { key: "insurance", label: "Insurance", count: d.invoices.filter((i) => i.status === "insurance_pending" || i.payer === "insurance").length },
              { key: "paid", label: "Settled", count: d.invoices.filter((i) => i.status === "paid").length },
            ]}
          />
        </div>
        <Table>
          <thead>
            <tr><Th>Invoice</Th><Th>Patient</Th><Th>Issued</Th><Th>Payer</Th><Th>Total</Th><Th>Outstanding</Th><Th>Status</Th><Th /></tr>
          </thead>
          <tbody>
            {rows.slice(0, 40).map((i) => {
              const p = d.patients.find((x) => x.id === i.patientId);
              const t = total(i);
              return (
                <Tr key={i.id} onClick={() => { setOpen(i); setPayAmount(t - i.paid); }}>
                  <Td className="font-mono text-xs font-medium text-ink-900">{i.number}</Td>
                  <Td>
                    <span className="block text-sm text-ink-900">{p?.name}</span>
                    <span className="block text-[11px] text-ink-400">{p?.mrn}</span>
                  </Td>
                  <Td className="text-xs text-ink-500">{relative(i.issuedAt)}</Td>
                  <Td className="text-xs">
                    {i.payer}
                    {i.insurer && <span className="block text-[11px] text-ink-400">{i.insurer}</span>}
                  </Td>
                  <Td className="tabular-nums font-medium">{inr(t)}</Td>
                  <Td className="tabular-nums">{t - i.paid > 0 ? <span className="font-medium text-rose-600">{inr(t - i.paid)}</span> : "—"}</Td>
                  <Td>
                    <Badge tone={i.status === "paid" ? "green" : i.status === "overdue" ? "red" : i.status === "insurance_pending" ? "purple" : "amber"}>
                      {i.status.replace("_", " ")}
                    </Badge>
                  </Td>
                  <Td><Button size="sm">Open</Button></Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Modal
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        wide
        title={open ? `Invoice ${open.number}` : ""}
        subtitle={open ? `${d.patients.find((p) => p.id === open.patientId)?.name} · issued ${fmtDate(open.issuedAt)}` : ""}
        footer={
          open && (
            <>
              <Button onClick={() => setOpen(null)}>Close</Button>
              <Button icon={<Send size={14} />} onClick={() => { audit("invoice.sent", open.number); notify("Payment link sent on WhatsApp"); }}>
                Send payment link
              </Button>
              {total(open) - open.paid > 0 && (
                <Button
                  variant="primary"
                  icon={<CreditCard size={14} />}
                  onClick={() => {
                    const t = total(open);
                    const newPaid = Math.min(t, open.paid + payAmount);
                    updateInvoice(open.id, { paid: newPaid, status: newPaid >= t ? "paid" : "part_paid", paymentMode: payMode });
                    audit("payment.recorded", `${open.number} — ${inr(payAmount)} via ${payMode}`, "warning");
                    notify(`Payment of ${inr(payAmount)} recorded`);
                    setOpen(null);
                  }}
                >
                  Record payment
                </Button>
              )}
            </>
          )
        }
      >
        {open && (
          <div className="grid gap-4 md:grid-cols-[1fr_240px]">
            <div>
              <Table>
                <thead>
                  <tr><Th>Description</Th><Th>Category</Th><Th>Qty</Th><Th>Rate</Th><Th>Amount</Th></tr>
                </thead>
                <tbody>
                  {open.lines.map((l, idx) => (
                    <Tr key={idx}>
                      <Td className="font-medium text-ink-900">{l.description}</Td>
                      <Td><Badge>{l.category}</Badge></Td>
                      <Td className="tabular-nums">{l.qty}</Td>
                      <Td className="tabular-nums">{inr(l.rate)}</Td>
                      <Td className="tabular-nums font-medium">{inr(l.qty * l.rate)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <div className="mt-3 space-y-1 text-sm">
                <p className="flex justify-between"><span className="text-ink-500">Gross</span><span className="tabular-nums">{inr(open.lines.reduce((s, l) => s + l.qty * l.rate, 0))}</span></p>
                {open.discount > 0 && <p className="flex justify-between"><span className="text-ink-500">Discount</span><span className="tabular-nums text-emerald-600">− {inr(open.discount)}</span></p>}
                <p className="flex justify-between border-t border-ink-200 pt-1 font-semibold"><span>Total</span><span className="tabular-nums">{inr(total(open))}</span></p>
                <p className="flex justify-between"><span className="text-ink-500">Paid</span><span className="tabular-nums text-emerald-600">{inr(open.paid)}</span></p>
                <p className="flex justify-between font-semibold"><span>Outstanding</span><span className="tabular-nums text-rose-600">{inr(total(open) - open.paid)}</span></p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-ink-200 p-3 text-xs">
                <p className="mb-2 text-xs font-semibold text-ink-900">Payer</p>
                <p className="flex justify-between"><span className="text-ink-500">Type</span><span className="font-medium">{open.payer}</span></p>
                {open.insurer && <p className="flex justify-between"><span className="text-ink-500">Insurer</span><span className="font-medium">{open.insurer}</span></p>}
                <p className="flex justify-between"><span className="text-ink-500">Status</span><Badge tone={open.status === "paid" ? "green" : "amber"}>{open.status.replace("_", " ")}</Badge></p>
              </div>
              {total(open) - open.paid > 0 && (
                <div className="rounded-xl border border-ink-200 p-3">
                  <p className="mb-2 text-xs font-semibold text-ink-900">Record a payment</p>
                  <label className="mb-2 block">
                    <span className="mb-1 block text-[11px] text-ink-500">Amount</span>
                    <Input type="number" value={payAmount} onChange={(e) => setPayAmount(Number(e.target.value))} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-ink-500">Mode</span>
                    <Select value={payMode} onChange={(e) => setPayMode(e.target.value as typeof payMode)}>
                      <option value="upi">UPI</option>
                      <option value="card">Card</option>
                      <option value="cash">Cash</option>
                      <option value="netbanking">Net banking</option>
                    </Select>
                  </label>
                </div>
              )}
              <Link href={`/patients/${open.patientId}`}>
                <Button size="sm" className="w-full">Open patient record</Button>
              </Link>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
