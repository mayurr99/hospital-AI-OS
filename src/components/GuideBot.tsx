"use client";

/**
 * Mitra — the in-app guide.
 *
 * A small resident creature that explains whichever screen you are on, can walk
 * a new hospital through the product in order, and says plainly when a screen
 * does not yet do what its buttons imply. Content lives in `src/lib/guide.ts`
 * so the bot stays a presentation layer over verified facts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { cx } from "@/lib/utils";
import {
  GREETINGS, GUIDE, STATUS_LABEL, TOUR, entryForPath,
  type GuideEntry, type GuideStatus,
} from "@/lib/guide";
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookOpen, CheckCircle2, ChevronRight, Compass,
  Lightbulb, MapPin, Search, Sparkles, X,
} from "lucide-react";
import { NAV } from "@/lib/nav";
import type { Permission } from "@/lib/types";

/* Permission and module requirements, mirrored from the sidebar so the guide
   never offers a screen the signed-in user cannot open. */
const NAV_INDEX: Record<string, { permission?: Permission; feature?: string }> = Object.fromEntries(
  NAV.flatMap((g) => g.items.map((i) => [i.href, { permission: i.permission, feature: i.feature }])),
);

type Mode = "here" | "browse" | "tour";

const STATUS_STYLE: Record<GuideStatus, string> = {
  working: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  partial: "bg-amber-50 text-amber-800 ring-amber-200",
  gap: "bg-rose-50 text-rose-700 ring-rose-200",
};

/* ------------------------------------------------------------------ pet */

/**
 * The mascot. Drawn rather than imported so it can react: it blinks on its own,
 * and tips its head while the panel is open.
 */
function Mitra({ size = 44, talking = false }: { size?: number; talking?: boolean }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="Mitra, the guide"
      className={cx("mitra", talking && "mitra--talking")}
    >
      {/* ears */}
      <path d="M14 20 L13 7 L26 14 Z" fill="var(--mitra-fur)" />
      <path d="M50 20 L51 7 L38 14 Z" fill="var(--mitra-fur)" />
      <path d="M16.5 18.5 L16 12 L23 15.5 Z" fill="var(--mitra-inner)" />
      <path d="M47.5 18.5 L48 12 L41 15.5 Z" fill="var(--mitra-inner)" />

      {/* head */}
      <ellipse cx="32" cy="30" rx="22" ry="19.5" fill="var(--mitra-fur)" />

      {/* cap — the reason it is allowed on a ward */}
      <path d="M20 15.5 Q32 7.5 44 15.5 L44 18 Q32 12.5 20 18 Z" fill="#ffffff" />
      <rect x="30.2" y="12.6" width="3.6" height="1.5" rx=".6" fill="var(--mitra-cross)" />
      <rect x="31.25" y="11.5" width="1.5" height="3.7" rx=".6" fill="var(--mitra-cross)" />

      {/* eyes */}
      <g className="mitra-eyes">
        <ellipse cx="24" cy="29" rx="4.4" ry="5" fill="#ffffff" />
        <ellipse cx="40" cy="29" rx="4.4" ry="5" fill="#ffffff" />
        <circle cx="24.8" cy="29.8" r="2.5" fill="#10231f" />
        <circle cx="40.8" cy="29.8" r="2.5" fill="#10231f" />
        <circle cx="25.8" cy="28.6" r=".9" fill="#ffffff" />
        <circle cx="41.8" cy="28.6" r=".9" fill="#ffffff" />
      </g>

      {/* muzzle */}
      <path d="M32 35.5 l-2.2 -2.4 h4.4 Z" fill="var(--mitra-nose)" />
      <path
        className="mitra-mouth"
        d="M32 36 q-3 3.4 -5.6 1.2 M32 36 q3 3.4 5.6 1.2"
        stroke="#10231f" strokeWidth="1.4" strokeLinecap="round" fill="none"
      />

      {/* whiskers */}
      <g stroke="var(--mitra-whisker)" strokeWidth="1.1" strokeLinecap="round">
        <path d="M15 32 L7 30" /><path d="M15 35 L7.5 35.5" />
        <path d="M49 32 L57 30" /><path d="M49 35 L56.5 35.5" />
      </g>

      {/* stethoscope */}
      <path
        d="M22 45 q10 7 20 0"
        stroke="var(--mitra-scope)" strokeWidth="2.4" fill="none" strokeLinecap="round"
      />
      <circle cx="42.4" cy="44.4" r="3.1" fill="var(--mitra-scope)" />
      <circle cx="42.4" cy="44.4" r="1.4" fill="#ffffff" opacity=".85" />
    </svg>
  );
}

/* ------------------------------------------------------------- the bot */

export default function GuideBot() {
  const pathname = usePathname();
  const router = useRouter();
  const { can, hasFeature, currentUser } = useStore();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("here");
  const [tourIndex, setTourIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [teaser, setTeaser] = useState<string | null>(null);
  const [greeting] = useState(() => GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
  const panelRef = useRef<HTMLDivElement>(null);

  /*
   * Mitra is rendered into <body> rather than inside the page.
   *
   * `position: fixed` is measured against the nearest ancestor that has a
   * transform, filter or backdrop-filter — not against the window. The
   * workspace shell legitimately uses all three (the sliding sidebar, the
   * frosted header), so a guide nested inside the page frame can be pinned to
   * the wrong box, or clipped away entirely, by a style change somewhere above
   * it. A portal puts it outside that risk permanently.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /* Any screen can summon the guide: window.dispatchEvent(new Event("mitra:open")). */
  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener("mitra:open", openIt);
    return () => window.removeEventListener("mitra:open", openIt);
  }, []);

  /* "?" opens the guide from anywhere, the way help is opened everywhere else. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const here = useMemo(() => entryForPath(pathname ?? ""), [pathname]);

  /* First visit gets one nudge, then never again. */
  useEffect(() => {
    let seen = true;
    try {
      seen = localStorage.getItem("mitra.greeted") === "1";
    } catch {
      seen = true;
    }
    if (seen) return;
    const t = setTimeout(() => setTeaser(greeting), 1400);
    return () => clearTimeout(t);
  }, [greeting]);

  const dismissTeaser = useCallback(() => {
    setTeaser(null);
    try {
      localStorage.setItem("mitra.greeted", "1");
    } catch {
      /* private window — the nudge simply returns next time */
    }
  }, []);

  /* Escape closes; the panel traps nothing else. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /* Following the tour scrolls the panel back to the top of the new step. */
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
  }, [mode, tourIndex, pathname]);

  if (!currentUser || !mounted) return null;

  /** Screens this user genuinely cannot reach are not offered. */
  const reachable = (e: GuideEntry) => {
    const nav = NAV_INDEX[e.path];
    if (!nav) return true;
    if (nav.permission && !can(nav.permission)) return false;
    if (nav.feature && !hasFeature(nav.feature)) return false;
    return true;
  };

  const visible = GUIDE.filter(reachable);
  const tour = TOUR.filter(reachable);
  const step = tour[Math.min(tourIndex, tour.length - 1)];

  const results = query.trim()
    ? visible.filter((e) => {
        const q = query.toLowerCase();
        return (
          e.title.toLowerCase().includes(q) ||
          e.blurb.toLowerCase().includes(q) ||
          e.group.toLowerCase().includes(q) ||
          e.steps.some((s) => s.text.toLowerCase().includes(q))
        );
      })
    : visible;

  const grouped = results.reduce<Record<string, GuideEntry[]>>((acc, e) => {
    (acc[e.group] ??= []).push(e);
    return acc;
  }, {});

  function goTo(entry: GuideEntry) {
    if (entry.path !== pathname && !entry.path.endsWith("/")) router.push(entry.path);
    setMode("here");
  }

  function startTour() {
    setMode("tour");
    setTourIndex(0);
    const first = tour[0];
    if (first && first.path !== pathname) router.push(first.path);
  }

  function moveTour(delta: number) {
    const next = Math.min(Math.max(tourIndex + delta, 0), tour.length - 1);
    setTourIndex(next);
    const target = tour[next];
    if (target && !target.path.endsWith("/") && target.path !== pathname) router.push(target.path);
  }

  return createPortal(
    <>
      <style>{`
        :root { --mitra-fur:#0f766e; --mitra-inner:#5eead4; --mitra-nose:#fda4af;
                --mitra-whisker:#99f6e4; --mitra-scope:#0b3b37; --mitra-cross:#0f766e; }
        .mitra { display:block; overflow:visible; }
        .mitra-eyes { transform-origin: 32px 29px; animation: mitra-blink 6.2s infinite; }
        .mitra--talking { animation: mitra-tilt 2.6s ease-in-out infinite; transform-origin: 32px 50px; }
        .mitra--talking .mitra-mouth { animation: mitra-talk 1.1s ease-in-out infinite; }
        @keyframes mitra-blink {
          0%,92%,100% { transform: scaleY(1); }
          94%,97%     { transform: scaleY(.08); }
        }
        @keyframes mitra-tilt {
          0%,100% { transform: rotate(-3deg); }
          50%     { transform: rotate(3deg); }
        }
        @keyframes mitra-talk {
          0%,100% { transform: translateY(0) scaleX(1); }
          50%     { transform: translateY(1px) scaleX(.86); }
        }
        @keyframes mitra-pop {
          from { opacity:0; transform: translateY(8px) scale(.96); }
          to   { opacity:1; transform: none; }
        }
        .mitra-pop { animation: mitra-pop .18s ease-out; }
        @media (prefers-reduced-motion: reduce) {
          .mitra-eyes, .mitra--talking, .mitra--talking .mitra-mouth, .mitra-pop { animation: none !important; }
        }
      `}</style>

      {/* ------------------------------------------------------ launcher */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 print:hidden">
        {teaser && !open && (
          <div className="mitra-pop pointer-events-auto max-w-[15rem] rounded-xl rounded-br-sm border border-ink-200 bg-white px-3 py-2 shadow-lg">
            <p className="text-xs text-ink-700">{teaser}</p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => { dismissTeaser(); setOpen(true); }}
                className="rounded-md bg-brand-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-brand-700"
              >
                Yes, show me
              </button>
              <button onClick={dismissTeaser} className="rounded-md px-2 py-1 text-[11px] text-ink-500 hover:bg-ink-100">
                Not now
              </button>
            </div>
          </div>
        )}

        {/*
          A bare circle in a corner reads as decoration. The word "Help" is what
          makes it a help button — it is the label people look for when they are
          stuck, and it survives being glanced past.
        */}
        {!open && (
          <button
            onClick={() => { dismissTeaser(); setOpen(true); }}
            aria-label="Open Mitra, the in-app guide"
            title="Open Mitra, the in-app guide  (press ?)"
            className="pointer-events-auto flex items-center gap-2 rounded-full bg-brand-600 py-1.5 pl-1.5 pr-4 text-white shadow-lg ring-1 ring-brand-700/20 transition hover:scale-105 hover:bg-brand-700 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <span className="grid h-11 w-11 place-items-center rounded-full bg-white">
              <Mitra size={34} />
            </span>
            <span className="text-sm font-semibold">Help</span>
          </button>
        )}
      </div>

      {/* --------------------------------------------------------- panel */}
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex justify-end p-0 sm:inset-auto sm:bottom-4 sm:right-4 print:hidden">
          <div className="mitra-pop flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl border border-ink-200 bg-white shadow-2xl sm:max-h-[min(38rem,85vh)] sm:w-[24rem] sm:rounded-2xl">

            {/* header */}
            <div className="flex items-start gap-3 border-b border-ink-200 bg-gradient-to-b from-brand-50/80 to-white px-4 py-3">
              <Mitra size={40} talking />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900">Mitra</p>
                <p className="truncate text-[11px] text-ink-500">Your guide to every screen here</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close the guide"
                className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              >
                <X size={17} />
              </button>
            </div>

            {/* mode switch */}
            <div className="flex gap-1 border-b border-ink-200 px-2 pt-2">
              {([
                ["here", "This screen", <MapPin key="a" size={13} />],
                ["browse", "All sections", <BookOpen key="b" size={13} />],
                ["tour", "Guided tour", <Compass key="c" size={13} />],
              ] as [Mode, string, React.ReactNode][]).map(([k, label, icon]) => (
                <button
                  key={k}
                  onClick={() => { setMode(k); if (k === "tour" && mode !== "tour") startTour(); }}
                  className={cx(
                    "-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-xs font-medium transition",
                    mode === k ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:text-ink-800",
                  )}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>

            <div ref={panelRef} className="flex-1 overflow-y-auto px-4 py-4">

              {/* ---------------------------------------------- this screen */}
              {mode === "here" && (
                here ? <EntryBody entry={here} /> : (
                  <div className="py-8 text-center">
                    <Sparkles size={22} className="mx-auto mb-2 text-ink-300" />
                    <p className="text-sm text-ink-600">I do not have notes on this screen yet.</p>
                    <button onClick={() => setMode("browse")} className="mt-3 text-xs font-medium text-brand-700 hover:underline">
                      Browse everything I do know
                    </button>
                  </div>
                )
              )}

              {/* -------------------------------------------------- browse */}
              {mode === "browse" && (
                <>
                  <div className="relative mb-3">
                    <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
                    <input
                      id="mitra-search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search — beds, import, verify…"
                      className="w-full rounded-lg border border-ink-200 bg-white py-1.5 pl-8 pr-2 text-sm outline-none placeholder:text-ink-400 focus:border-brand-500"
                    />
                  </div>

                  {Object.entries(grouped).map(([group, entries]) => (
                    <div key={group} className="mb-4">
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">{group}</p>
                      <div className="space-y-1">
                        {entries.map((e) => (
                          <button
                            key={e.path}
                            onClick={() => goTo(e)}
                            className="flex w-full items-start gap-2 rounded-lg border border-ink-200 px-2.5 py-2 text-left transition hover:border-brand-300 hover:bg-brand-50/50"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-[13px] font-medium text-ink-900">{e.title}</span>
                                <StatusDot status={e.status} />
                              </span>
                              <span className="mt-0.5 block text-[11px] leading-snug text-ink-500">{e.blurb}</span>
                            </span>
                            <ChevronRight size={14} className="mt-0.5 shrink-0 text-ink-300" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  {results.length === 0 && (
                    <p className="py-6 text-center text-sm text-ink-500">Nothing matches “{query}”.</p>
                  )}
                </>
              )}

              {/* ---------------------------------------------------- tour */}
              {mode === "tour" && step && (
                <>
                  <div className="mb-3 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-100">
                      <div
                        className="h-full rounded-full bg-brand-600 transition-all"
                        style={{ width: `${((tourIndex + 1) / tour.length) * 100}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-[11px] tabular-nums text-ink-500">
                      {tourIndex + 1} / {tour.length}
                    </span>
                  </div>
                  <EntryBody entry={step} />
                </>
              )}
            </div>

            {/* footer */}
            <div className="flex items-center justify-between gap-2 border-t border-ink-200 bg-ink-50/60 px-3 py-2.5">
              {mode === "tour" ? (
                <>
                  <button
                    onClick={() => moveTour(-1)}
                    disabled={tourIndex === 0}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-100 disabled:opacity-40"
                  >
                    <ArrowLeft size={13} /> Back
                  </button>
                  {tourIndex >= tour.length - 1 ? (
                    <button
                      onClick={() => { setMode("here"); setOpen(false); }}
                      className="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                    >
                      <CheckCircle2 size={13} /> Finish
                    </button>
                  ) : (
                    <button
                      onClick={() => moveTour(1)}
                      className="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                    >
                      Next <ArrowRight size={13} />
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p className="text-[11px] text-ink-500">
                    {visible.length} screens · {tour.length}-stop tour
                  </p>
                  <button
                    onClick={startTour}
                    className="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                  >
                    <Compass size={13} /> Take the tour
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}

/* -------------------------------------------------------------- pieces */

function StatusDot({ status }: { status: GuideStatus }) {
  if (status === "working") return null;
  return (
    <span className={cx("rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide ring-1 ring-inset", STATUS_STYLE[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function EntryBody({ entry }: { entry: GuideEntry }) {
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold text-ink-900">{entry.title}</h3>
        <span className={cx("rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-1 ring-inset", STATUS_STYLE[entry.status])}>
          {STATUS_LABEL[entry.status]}
        </span>
      </div>
      <p className="mb-3 text-[13px] leading-relaxed text-ink-600">{entry.blurb}</p>

      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
        Who works here — {entry.roles.join(", ")}
      </p>

      <ol className="mb-3 space-y-2">
        {entry.steps.map((s, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-700">
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-brand-700">{s.who}</span>
              <span className="block text-[13px] leading-relaxed text-ink-700">{s.text}</span>
              {s.note && <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-500">{s.note}</span>}
            </span>
          </li>
        ))}
      </ol>

      {entry.tip && (
        <div className="mb-2 flex gap-2 rounded-lg border border-brand-200 bg-brand-50/70 px-2.5 py-2">
          <Lightbulb size={14} className="mt-0.5 shrink-0 text-brand-700" />
          <p className="text-[12px] leading-relaxed text-ink-700">{entry.tip}</p>
        </div>
      )}

      {entry.gap && (
        <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-rose-600" />
          <p className="text-[12px] leading-relaxed text-rose-900">
            <b className="font-semibold">Not built yet — </b>{entry.gap}
          </p>
        </div>
      )}
    </div>
  );
}
