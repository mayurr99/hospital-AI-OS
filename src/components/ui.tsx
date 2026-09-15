"use client";

import React from "react";
import { cx } from "@/lib/utils";
import { X } from "lucide-react";

/* ---------------------------------------------------------------- Card */
export function Card({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div className={cx("min-w-0 rounded-xl border border-ink-200 bg-white shadow-sm", padded && "p-5", className)}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        {icon && <div className="mt-0.5 rounded-lg bg-brand-50 p-2 text-brand-700">{icon}</div>}
        <div>
          <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------- Button */
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  size?: "sm" | "md";
  icon?: React.ReactNode;
};

export function Button({ variant = "secondary", size = "md", icon, className, children, ...rest }: ButtonProps) {
  const styles = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
    secondary: "bg-white text-ink-700 ring-1 ring-inset ring-ink-200 hover:bg-ink-50",
    ghost: "text-ink-600 hover:bg-ink-100",
    danger: "bg-rose-600 text-white hover:bg-rose-700 shadow-sm",
    success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm",
  }[variant];
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        styles,
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- Badge */
export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "brand" | "green" | "amber" | "red" | "blue" | "purple";
  className?: string;
}) {
  const tones = {
    neutral: "bg-ink-100 text-ink-700 ring-ink-300/60",
    brand: "bg-brand-50 text-brand-700 ring-brand-600/20",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
    red: "bg-rose-50 text-rose-700 ring-rose-600/20",
    blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
    purple: "bg-violet-50 text-violet-700 ring-violet-600/20",
  }[tone];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        tones,
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------ StatTile */
export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "neutral" | "green" | "amber" | "red" | "brand";
  onClick?: () => void;
}) {
  const accent = {
    neutral: "text-ink-500 bg-ink-100",
    green: "text-emerald-700 bg-emerald-50",
    amber: "text-amber-700 bg-amber-50",
    red: "text-rose-700 bg-rose-50",
    brand: "text-brand-700 bg-brand-50",
  }[tone];
  return (
    <div
      onClick={onClick}
      className={cx(
        "rounded-xl border border-ink-200 bg-white p-4 shadow-sm transition",
        onClick && "cursor-pointer hover:border-brand-300 hover:shadow",
      )}
    >
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-ink-500">{label}</p>
        {icon && <span className={cx("rounded-lg p-1.5", accent)}>{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-ink-900 tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-500">{sub}</p>}
    </div>
  );
}

/* --------------------------------------------------------------- Table */
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("w-full max-w-full overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={cx("border-b border-ink-200 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-500", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cx("border-b border-ink-100 px-3 py-2.5 align-middle text-ink-700", className)}>{children}</td>;
}

export function Tr({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <tr onClick={onClick} className={cx(onClick && "cursor-pointer hover:bg-brand-50/40", className)}>
      {children}
    </tr>
  );
}

/* --------------------------------------------------------------- Modal */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  /*
   * Escape closes, clicking the backdrop closes, and the first field takes
   * focus. These are the three things people try without thinking; a dialog
   * that ignores all of them feels stuck, and the only way out being a small X
   * in the corner is what makes a form feel like a trap.
   */
  const panel = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    /* Keep the page behind from scrolling under the dialog. */
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>(
        "input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])",
      );
      first?.focus();
    }, 30);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={panel}
        className={cx(
          "animate-fade-up my-8 w-full rounded-2xl bg-white shadow-2xl",
          wide ? "max-w-4xl" : "max-w-lg",
        )}
      >
        <div className="flex items-start justify-between border-b border-ink-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-ink-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * A confirmation step for actions that are consequential or cannot be undone.
 *
 * Deliberately spells out what will happen rather than asking "Are you sure?",
 * because the second question is one people learn to click through.
 */
export function Confirm({
  open, onCancel, onConfirm, title, body, confirmLabel = "Confirm", tone = "danger", busy,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant={tone} onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-ink-700">{body}</div>
    </Modal>
  );
}

/* --------------------------------------------------------------- Field */
export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  /** Shown in place of the hint, in red. Use it to say what is wrong, not that something is. */
  error?: string;
  /** Marks the field so people can see what a disabled Save button is waiting for. */
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-xs font-medium text-ink-600">
        {label}
        {required && <span className="ml-0.5 text-rose-500" title="Required">*</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11px] font-medium text-rose-600">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-[11px] text-ink-400">{hint}</span>
      )}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";

/* `ComponentPropsWithRef` rather than `InputHTMLAttributes`, so a caller can
   hold a ref — focusing the code box on a two-step sign-in screen, for one.
   React 19 passes `ref` as an ordinary prop; only the type stood in the way. */
export function Input(props: React.ComponentPropsWithRef<"input">) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function Select(props: React.ComponentPropsWithRef<"select">) {
  return <select {...props} className={cx(inputCls, "pr-8", props.className)} />;
}

export function Textarea(props: React.ComponentPropsWithRef<"textarea">) {
  return <textarea {...props} className={cx(inputCls, "min-h-[80px] resize-y", props.className)} />;
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div>
        <p className="text-sm font-medium text-ink-800">{label}</p>
        {description && <p className="text-xs text-ink-500">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition",
          checked ? "bg-brand-600" : "bg-ink-300",
        )}
        aria-pressed={checked}
        aria-label={label}
      >
        <span
          className={cx(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- Tabs */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string; count?: number }[];
  active: T;
  onChange: (k: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-ink-200">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cx(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition",
            active === t.key
              ? "border-brand-600 text-brand-700"
              : "border-transparent text-ink-500 hover:border-ink-300 hover:text-ink-700",
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span
              className={cx(
                "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                active === t.key ? "bg-brand-100 text-brand-700" : "bg-ink-100 text-ink-500",
              )}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------- Empty state */
export function EmptyState({
  title, hint, icon, action, loading,
}: {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
  /** The way out. An empty state without one is a dead end. */
  action?: React.ReactNode;
  /** True while data is still arriving, so "nothing here" is never shown too early. */
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-200 bg-ink-50/40 px-6 py-12 text-center">
        <span className="mb-3 h-5 w-5 animate-spin rounded-full border-2 border-ink-200 border-t-brand-600" />
        <p className="text-sm text-ink-400">Loading…</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-ink-50/60 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-ink-400">{icon}</div>}
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-ink-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * Says what a list is showing against what exists.
 *
 * Every screen that renders `rows.slice(0, n)` needs one of these. Without it a
 * capped list is indistinguishable from a complete one, and staff conclude a
 * record is missing when it is simply below the cut.
 */
export function ShowingCount({
  shown, total, noun = "records", hint,
}: { shown: number; total: number; noun?: string; hint?: string }) {
  if (total <= shown) return null;
  return (
    <p className="border-t border-ink-100 px-4 py-2.5 text-xs text-ink-400">
      Showing {shown.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")} {noun}
      {hint ? ` — ${hint}` : " — narrow the filters to see the rest."}
    </p>
  );
}

/* -------------------------------------------------------------- Avatar */
export function Avatar({ name, hue = 180, size = 36 }: { name: string; hue?: number; size?: number }) {
  const label = name
    .replace(/^Dr\.?\s+/i, "")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, hsl(${hue} 55% 45%), hsl(${(hue + 40) % 360} 60% 38%))`,
      }}
    >
      {label}
    </span>
  );
}

/* ------------------------------------------------------------- Progress */
export function Progress({ value, max = 100, tone = "brand" }: { value: number; max?: number; tone?: "brand" | "green" | "amber" | "red" }) {
  const pctVal = Math.min(100, Math.round((value / (max || 1)) * 100));
  const bg = { brand: "bg-brand-500", green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-rose-500" }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-200">
      <div className={cx("h-full rounded-full transition-all", bg)} style={{ width: `${pctVal}%` }} />
    </div>
  );
}

/* ----------------------------------------------------------- PageHeader */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
