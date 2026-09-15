import type { LanguageCode, RiskLevel } from "./types";

export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  mr: "मराठी Marathi",
  hi: "हिन्दी Hindi",
  en: "English",
  hinglish: "Hinglish (code-mixed)",
};

export const LANGUAGE_SHORT: Record<LanguageCode, string> = {
  mr: "MR", hi: "HI", en: "EN", hinglish: "HI-EN",
};

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function inr(n: number, compact = false) {
  if (compact) {
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
    if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
    if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  }
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

export function fmtDateTime(iso: string) {
  return `${fmtDate(iso)}, ${fmtTime(iso)}`;
}

export function relative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const d = Math.round(hr / 24);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  return fmtDate(iso);
}

export function relativeFuture(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return `overdue by ${relative(iso).replace(" ago", "")}`;
  const min = Math.round(diff / 60000);
  if (min < 60) return `in ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `in ${hr} hr`;
  return `in ${Math.round(hr / 24)} days`;
}

export function duration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export const RISK_STYLES: Record<RiskLevel, { label: string; chip: string; dot: string }> = {
  green: { label: "Routine", chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", dot: "bg-emerald-500" },
  amber: { label: "Review", chip: "bg-amber-50 text-amber-800 ring-amber-600/20", dot: "bg-amber-500" },
  red: { label: "Escalation", chip: "bg-rose-50 text-rose-700 ring-rose-600/20", dot: "bg-rose-500" },
};

export function initials(name: string) {
  return name
    .replace(/^Dr\.?\s+/i, "")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function pct(num: number, den: number) {
  if (!den) return "0%";
  return `${Math.round((num / den) * 100)}%`;
}

export function csvEscape(v: unknown) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const body = [headers.join(","), ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(","))].join("\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
