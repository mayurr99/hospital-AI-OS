"use client";

import { useMemo, useState } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { useSticky } from "@/lib/sticky";
import { Denied } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, Field, Input, Modal, PageHeader, StatTile, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { cx, fmtDate, inr } from "@/lib/utils";
import type { Drug } from "@/lib/types";
import { AlertTriangle, CalendarX, Package, PackagePlus, Pill, Search, ShieldAlert, TrendingDown } from "lucide-react";

type TabKey = "all" | "low" | "expiring" | "scheduleH";

export default function PharmacyPage() {
  const { can, updateDrug, notify } = useStore();
  const d = useOrgData();
  const [tab, setTab] = useSticky<TabKey>("pharmacy.tab", "all");
  const [q, setQ] = useSticky("pharmacy.q", "");
  const [reorder, setReorder] = useState<Drug | null>(null);
  const [qty, setQty] = useState(500);

  const expiringSoon = useMemo(
    () => d.drugs.filter((x) => new Date(x.expiry).getTime() - Date.now() < 90 * 86400000),
    [d.drugs],
  );

  if (!can("pharmacy.manage")) return <Denied />;

  const rows = d.drugs.filter((x) => {
    if (tab === "low" && x.stock >= x.reorderLevel) return false;
    if (tab === "expiring" && !expiringSoon.includes(x)) return false;
    if (tab === "scheduleH" && !x.scheduleH) return false;
    if (q && !x.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const lowStock = d.drugs.filter((x) => x.stock < x.reorderLevel);
  const stockValue = d.drugs.reduce((s, x) => s + x.stock * x.unitPrice, 0);

  return (
    <>
      <PageHeader title="Pharmacy" subtitle="Stock levels, reorder alerts, expiry control and Schedule H tracking" />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Items in formulary" value={d.drugs.length} icon={<Pill size={15} />} />
        <StatTile label="Below reorder level" value={lowStock.length} tone={lowStock.length ? "red" : "green"} icon={<TrendingDown size={15} />} />
        <StatTile label="Expiring within 90 days" value={expiringSoon.length} tone="amber" icon={<CalendarX size={15} />} />
        <StatTile label="Stock value" value={inr(stockValue, true)} sub="at current unit price" tone="brand" icon={<Package size={15} />} />
      </div>

      {lowStock.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          <AlertTriangle size={15} />
          <strong>{lowStock.length} items</strong> are below reorder level —
          <span className="text-xs">{lowStock.slice(0, 4).map((x) => x.name).join(", ")}{lowStock.length > 4 ? `, +${lowStock.length - 4} more` : ""}</span>
        </div>
      )}

      <Card padded={false}>
        <div className="border-b border-ink-200 px-4 pt-2">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: "all", label: "All stock", count: d.drugs.length },
              { key: "low", label: "Reorder now", count: lowStock.length },
              { key: "expiring", label: "Expiring soon", count: expiringSoon.length },
              { key: "scheduleH", label: "Schedule H", count: d.drugs.filter((x) => x.scheduleH).length },
            ]}
          />
        </div>
        <div className="border-b border-ink-200 px-4 py-3">
          <div className="relative max-w-sm">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <Input className="pl-9" placeholder="Search drug name…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        <Table>
          <thead>
            <tr><Th>Drug</Th><Th>Batch</Th><Th>Expiry</Th><Th>Stock</Th><Th>Reorder at</Th><Th>Unit price</Th><Th>Supplier</Th><Th /></tr>
          </thead>
          <tbody>
            {rows.map((x) => {
              const low = x.stock < x.reorderLevel;
              const exp = new Date(x.expiry).getTime() - Date.now();
              const expired = exp < 0;
              return (
                <Tr key={x.id}>
                  <Td>
                    <span className="block text-sm font-medium text-ink-900">{x.name}</span>
                    <span className="block text-[11px] text-ink-400">
                      {x.form} · {x.strength}
                      {x.scheduleH && <Badge tone="purple" className="ml-1">Schedule H</Badge>}
                    </span>
                  </Td>
                  <Td className="font-mono text-xs">{x.batch}</Td>
                  <Td className={cx("text-xs", expired ? "font-semibold text-rose-600" : exp < 90 * 86400000 ? "text-amber-600" : "text-ink-600")}>
                    {fmtDate(x.expiry)}
                    {expired && " · EXPIRED"}
                  </Td>
                  <Td>
                    <span className={cx("font-semibold tabular-nums", low ? "text-rose-600" : "text-ink-900")}>{x.stock}</span>
                  </Td>
                  <Td className="tabular-nums text-xs text-ink-500">{x.reorderLevel}</Td>
                  <Td className="tabular-nums text-xs">{inr(x.unitPrice)}</Td>
                  <Td className="text-xs text-ink-500">{x.supplier}</Td>
                  <Td>
                    {low && (
                      <Button size="sm" variant="primary" icon={<PackagePlus size={13} />} onClick={() => { setReorder(x); setQty(x.reorderLevel * 5); }}>
                        Reorder
                      </Button>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Where pharmacy meets the AI layer" icon={<ShieldAlert size={16} />} />
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ["Adherence, not prescribing", "The follow-up agent asks whether the prescribed medicines were taken and records missed doses. It cannot start, stop or change a dose — those tools are simply not in its allow-list."],
            ["Refill reminders", "When a dispensed course is about to run out, the patient gets a WhatsApp or call reminder in their language, with a link to collect or reorder."],
            ["Side-effect capture", "Reported side effects are captured verbatim as structured fields and routed to a clinician — the AI never interprets or diagnoses them."],
          ].map(([t, s]) => (
            <div key={t} className="rounded-lg border border-ink-200 p-3">
              <p className="text-xs font-semibold text-ink-900">{t}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-600">{s}</p>
            </div>
          ))}
        </div>
      </Card>

      <Modal
        open={Boolean(reorder)}
        onClose={() => setReorder(null)}
        title={`Record stock received — ${reorder?.name ?? ""}`}
        subtitle={reorder ? `Current stock ${reorder.stock} · reorder level ${reorder.reorderLevel} · ${reorder.supplier}` : ""}
        footer={
          <>
            <Button onClick={() => setReorder(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!qty || qty < 1}
              onClick={() => {
                /*
                  This used to say "Purchase order raised" while quietly adding
                  the quantity to stock — recording goods as received before
                  anyone had ordered them, let alone taken delivery. There is no
                  purchase-order module, so this records what actually happened:
                  a stock receipt, entered by a person, dated now.
                */
                updateDrug(reorder!.id, {
                  stock: reorder!.stock + qty,
                  lastReceivedAt: new Date().toISOString(),
                });
                notify(`Stock updated — ${qty} units of ${reorder!.name} received into inventory`);
                setReorder(null);
              }}
            >
              Record stock received
            </Button>
          </>
        }
      >
        <Field label="Quantity received" required hint="Enter what has physically arrived — this adds to the stock on hand">
          <Input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
        </Field>
        {reorder && (
          <p className="mt-3 rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
            Value at unit price <strong className="text-ink-900">{inr(qty * reorder.unitPrice)}</strong> · stock on hand
            becomes <strong className="text-ink-900">{reorder.stock + qty}</strong> (reorder level {reorder.reorderLevel},
            supplier {reorder.supplier}).
            <span className="mt-1 block text-ink-500">
              Purchase orders are not managed in this system yet — this records the receipt only.
            </span>
          </p>
        )}
      </Modal>
    </>
  );
}
