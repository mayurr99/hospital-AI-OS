"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useOrgData, useStore } from "@/lib/store";
import { NAV } from "@/lib/nav";
import { ROLE_LABELS } from "@/lib/rbac";
import { Avatar, Badge, Button } from "@/components/ui";
import { cx } from "@/lib/utils";
import {
  Activity, Ambulance, BedDouble, Bot, Building2, CalendarDays, CheckCircle2, ChevronDown, ClipboardList,
  CreditCard, Download, FileCheck2, FileSpreadsheet, FlaskConical, Globe2, HardDrive, HeartPulse, HelpCircle,
  LayoutDashboard, Lock, LogOut, Megaphone, Menu, MessageSquare, Mic, Mic2, Phone, PhoneCall,
  PhoneForwarded, PhoneIncoming, Pill, Plug, Radio, Receipt, ScrollText, Search, ShieldCheck, Siren,
  Sparkles, Stethoscope, TrendingUp, Users, X,
} from "lucide-react";

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  LayoutDashboard, TrendingUp, Radio, PhoneIncoming, Megaphone, PhoneCall, Mic, Stethoscope, ClipboardList,
  Siren, Users, CalendarDays, BedDouble, Activity, FlaskConical, Pill, Ambulance, MessageSquare, Receipt,
  FileSpreadsheet, Download, ShieldCheck, Bot, FileCheck2, Building2, Mic2, HardDrive, PhoneForwarded,
  CreditCard, Phone, Plug, ScrollText, Globe2, HeartPulse,
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const store = useStore();
  const { ready, authenticated, currentUser, org, organizations, subscription, can, hasFeature, logout, toast, setActiveOrg } = store;
  const data = useOrgData();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [orgMenu, setOrgMenu] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [query, setQuery] = useState("");

  const [recheckedAuth, setRecheckedAuth] = useState(false);

  /**
   * The store is fetched once when the provider mounts. If the user signed in
   * on a page that mounted before the session existed, re-verify with the
   * server before bouncing them back to the login screen.
   */
  useEffect(() => {
    if (!ready || authenticated) return;
    if (!recheckedAuth) {
      setRecheckedAuth(true);
      void store.refresh();
      return;
    }
    router.replace("/login");
  }, [ready, authenticated, recheckedAuth, router, store]);

  useEffect(() => setMobileOpen(false), [pathname]);

  /*
   * "/" and Ctrl/Cmd-K jump to the global search from anywhere, and Escape
   * leaves it. Reception and nursing staff work at the keyboard with a queue of
   * people in front of them; reaching for the mouse to find a patient is the
   * single most repeated bit of friction in the product.
   */
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape" && typing && el === searchRef.current) {
        setQuery("");
        searchRef.current?.blur();
        return;
      }
      const slash = e.key === "/" && !typing && !e.ctrlKey && !e.metaKey;
      const cmdK = e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey);
      if (!slash && !cmdK) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /*
   * Counts come from the server with the shell, so the sidebar is correct on the
   * first frame instead of reading zero until every collection has downloaded.
   * Once the collections land they take over, because they reflect edits the
   * user has made since the page opened.
   */
  const serverBadges = store.badges;
  const badges = useMemo(
    () => ({
      escalations: store.dataReady
        ? data.escalations.filter((e) => e.status === "open").length
        : serverBadges?.escalations ?? 0,
      tasks: store.dataReady
        ? data.tasks.filter((t) => t.status === "open").length
        : serverBadges?.tasks ?? 0,
      messages: store.dataReady
        ? data.threads.reduce((s, t) => s + t.unread, 0)
        : serverBadges?.messages ?? 0,
      live: 1,
    }),
    [data, store.dataReady, serverBadges],
  );

  const searchResults = useMemo(() => {
    if (query.trim().length < 2) return [];
    const q = query.toLowerCase();
    return [
      ...data.patients
        .filter((p) => p.name.toLowerCase().includes(q) || p.mrn.toLowerCase().includes(q) || p.phone.includes(q))
        .slice(0, 5)
        .map((p) => ({ href: `/patients/${p.id}`, label: p.name, meta: `${p.mrn} · ${p.diagnosis}` })),
      ...data.providers
        .filter((p) => p.name.toLowerCase().includes(q))
        .slice(0, 3)
        .map((p) => ({ href: `/appointments?provider=${p.id}`, label: p.name, meta: p.speciality })),
    ];
  }, [query, data]);

  if (!ready || !authenticated || !currentUser) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-100">
        <p className="text-sm text-ink-500">Loading workspace…</p>
      </div>
    );
  }

  const visibleGroups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => (!i.permission || can(i.permission)) && (!i.feature || hasFeature(i.feature))),
  })).filter((g) => g.items.length);

  const trialing = subscription?.status === "trialing";
  const expired = subscription?.status === "trial_expired";

  return (
    <div className="min-h-screen">
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-40 flex w-[262px] flex-col border-r border-ink-200 bg-white transition-transform lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-ink-200 px-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">AI</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink-900">Hospital AI OS</p>
            <p className="truncate text-[10px] text-ink-400">Patient engagement platform</p>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setMobileOpen(false)}>
            <X size={18} className="text-ink-400" />
          </button>
        </div>

        {org && (
          <div className="relative border-b border-ink-200 px-3 py-2.5">
            <button
              onClick={() => can("tenant.manage") && setOrgMenu((v) => !v)}
              className={cx("flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left", can("tenant.manage") ? "hover:bg-ink-100" : "cursor-default")}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[11px] font-bold text-white" style={{ background: org.accentColor }}>
                {org.logoInitials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-ink-900">{org.name}</span>
                <span className="block truncate text-[10px] text-ink-400">
                  {org.city || "—"} · {String(org.plan).replace("_", " ")} plan
                </span>
              </span>
              {can("tenant.manage") && <ChevronDown size={14} className="shrink-0 text-ink-400" />}
            </button>
            {orgMenu && (
              <div className="absolute left-3 right-3 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-ink-200 bg-white shadow-lg">
                {organizations.map((o) => (
                  <button
                    key={o.id}
                    onClick={async () => {
                      setOrgMenu(false);
                      /* Picking a hospital switches to it. It previously bounced
                         everyone to the tenant console instead, including when
                         they picked the hospital they were already in. */
                      if (o.id === org.id) return;
                      await setActiveOrg(o.id);
                      router.push("/dashboard");
                    }}
                    className={cx("flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-ink-50", o.id === org.id && "bg-brand-50")}
                  >
                    <span className="grid h-6 w-6 place-items-center rounded text-[9px] font-bold text-white" style={{ background: o.accentColor }}>
                      {o.logoInitials}
                    </span>
                    <span className="flex-1 truncate text-ink-800">{o.name}</span>
                    {o.id === org.id && <CheckCircle2 size={13} className="text-brand-600" />}
                  </button>
                ))}
                <p className="border-t border-ink-100 px-3 py-1.5 text-[10px] text-ink-400">
                  Switching requires a justification and is audited.
                </p>
              </div>
            )}
          </div>
        )}

        {(trialing || expired) && (
          <Link href="/settings/plan" className="mx-3 mt-3 block">
            <div className={cx("rounded-lg p-2.5 ring-1", expired ? "bg-rose-50 ring-rose-200" : "bg-amber-50 ring-amber-200")}>
              <p className={cx("flex items-center gap-1.5 text-[11px] font-semibold", expired ? "text-rose-800" : "text-amber-800")}>
                <Sparkles size={12} />
                {expired ? "Trial ended" : `${subscription?.trialDaysLeft} day${subscription?.trialDaysLeft === 1 ? "" : "s"} left in trial`}
              </p>
              <p className={cx("mt-0.5 text-[10px] leading-relaxed", expired ? "text-rose-700" : "text-amber-700")}>
                {expired ? "Calling is paused. Choose a plan to resume." : `${subscription?.voiceMinutesUsed ?? 0} of ${subscription?.voiceMinutesCap ?? 0} voice minutes used.`}
              </p>
            </div>
          </Link>
        )}

        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-ink-400">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = ICONS[item.icon] ?? LayoutDashboard;
                  const active = pathname === item.href || pathname.startsWith(item.href + "/");
                  const count = item.badge ? badges[item.badge] : 0;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cx(
                        "group flex items-center gap-2.5 rounded-lg px-2 py-[7px] text-[13px] font-medium transition",
                        active ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
                      )}
                    >
                      <Icon size={16} className={active ? "text-brand-600" : "text-ink-400"} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge === "live" ? (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-rose-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500 pulse-ring" />
                          LIVE
                        </span>
                      ) : count > 0 ? (
                        <span className="rounded-full bg-rose-100 px-1.5 text-[10px] font-semibold text-rose-700">{count}</span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-ink-200 p-3">
          <div className="rounded-lg bg-ink-50 p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Signed in as</p>
            <p className="mt-0.5 truncate text-xs font-medium text-ink-800">{currentUser.name}</p>
            <p className="truncate text-[11px] text-ink-500">{ROLE_LABELS[currentUser.role]}</p>
          </div>
        </div>
      </aside>

      {mobileOpen && <div className="fixed inset-0 z-30 bg-ink-900/30 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <div className="lg:pl-[262px]">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-ink-200 bg-white/90 px-4 backdrop-blur">
          <button className="lg:hidden" onClick={() => setMobileOpen(true)}>
            <Menu size={20} className="text-ink-600" />
          </button>

          <div className="relative max-w-md flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search patients, MRN, phone, doctors…"
              className="w-full rounded-lg border border-ink-200 bg-ink-50 py-1.5 pl-9 pr-12 text-sm outline-none transition focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/20"
            />
            {!query && (
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-ink-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-ink-400 sm:block">
                /
              </kbd>
            )}
            {searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-ink-200 bg-white shadow-lg">
                {searchResults.map((r) => (
                  <Link key={r.href + r.label} href={r.href} onClick={() => setQuery("")} className="block px-3 py-2 hover:bg-ink-50">
                    <p className="text-sm text-ink-900">{r.label}</p>
                    <p className="text-[11px] text-ink-500">{r.meta}</p>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/*
              Whether this screen is live.

              Staff need to know when what they are looking at has stopped
              updating — a ward board that has quietly gone stale is how someone
              walks a patient to an occupied bed. Silent when healthy; explicit
              when not.
            */}
            {store.liveStatus !== "live" && (
              <span
                title={
                  store.liveStatus === "connecting"
                    ? "Connecting to live updates…"
                    : "Not receiving live updates — this screen may be out of date. Reconnecting automatically."
                }
                className={cx(
                  "flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium",
                  store.liveStatus === "connecting" ? "bg-ink-100 text-ink-500" : "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
                )}
              >
                <span className={cx("h-1.5 w-1.5 rounded-full", store.liveStatus === "connecting" ? "bg-ink-400 animate-pulse" : "bg-amber-500")} />
                <span className="hidden sm:inline">{store.liveStatus === "connecting" ? "Connecting" : "Not live"}</span>
              </span>
            )}
            {/*
              A second door to the guide. The floating launcher is easy to miss
              or to mistake for decoration; a labelled control in the header is
              where people look for help, and it keeps working if the corner is
              ever covered.
            */}
            <button
              onClick={() => window.dispatchEvent(new Event("mitra:open"))}
              title="Open the in-app guide  (press ?)"
              className="flex items-center gap-1.5 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
            >
              <HelpCircle size={14} />
              <span className="hidden sm:inline">Help</span>
            </button>
            {badges.escalations > 0 && can("escalations.view") && (
              <Link href="/escalations">
                <Badge tone="red" className="cursor-pointer">
                  <Siren size={11} /> {badges.escalations} open
                </Badge>
              </Link>
            )}
            <div className="relative">
              <button onClick={() => setUserMenu((v) => !v)} className="flex items-center gap-2 rounded-lg p-1 hover:bg-ink-100">
                <Avatar name={currentUser.name} size={30} hue={currentUser.role === "doctor" ? 200 : 170} />
                <ChevronDown size={14} className="text-ink-400" />
              </button>
              {userMenu && (
                <div className="absolute right-0 top-full z-30 mt-1 w-60 overflow-hidden rounded-lg border border-ink-200 bg-white shadow-lg">
                  <div className="border-b border-ink-100 px-3 py-2.5">
                    <p className="text-sm font-medium text-ink-900">{currentUser.name}</p>
                    <p className="text-xs text-ink-500">{currentUser.email}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge tone="brand">{ROLE_LABELS[currentUser.role]}</Badge>
                      {/*
                        This badge used to read "MFA not enforced" — honest at
                        the time, because nothing challenged for it. It now
                        reports the real state of this account: on, or off and
                        one click from being set up.
                      */}
                      {currentUser.mfaEnrolled ? (
                        <Badge tone="green">Two-step on</Badge>
                      ) : (
                        <Badge tone="amber">Two-step off</Badge>
                      )}
                    </div>
                  </div>
                  <Link
                    href="/settings/security"
                    onClick={() => setUserMenu(false)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-700 hover:bg-ink-50"
                  >
                    <ShieldCheck size={14} /> Security & two-step sign-in
                  </Link>
                  <button
                    onClick={async () => {
                      await logout();
                      router.push("/login");
                    }}
                    className="flex w-full items-center gap-2 border-t border-ink-100 px-3 py-2 text-left text-sm text-ink-700 hover:bg-ink-50"
                  >
                    <LogOut size={14} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6" onClick={() => { setOrgMenu(false); setUserMenu(false); }}>
          {expired && (
            <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
              <Lock size={16} className="text-rose-600" />
              <div className="min-w-[240px] flex-1">
                <p className="text-sm font-semibold text-rose-900">Your free trial has ended</p>
                <p className="text-xs text-rose-700">
                  Your data is safe and the workspace is read-only for calling. Choose a plan to start patient calls again.
                </p>
              </div>
              <Link href="/settings/plan"><Button variant="danger" size="sm">Choose a plan</Button></Link>
            </div>
          )}
          {children}
        </main>
      </div>

      {toast && (
        <div className="animate-fade-up fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-ink-900 px-4 py-2.5 text-sm text-white shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

export function Denied({ reason }: { reason?: string }) {
  return (
    <div className="grid place-items-center py-20 text-center">
      <ShieldCheck size={32} className="mb-3 text-ink-300" />
      <p className="text-sm font-medium text-ink-800">{reason ?? "You do not have permission to view this area"}</p>
      <p className="mt-1 max-w-sm text-xs text-ink-500">
        Access is granted per role by the hospital admin, and modules are unlocked per plan. Ask your administrator if
        you need this.
      </p>
      <Link href="/dashboard" className="mt-4">
        <Button variant="secondary" size="sm">Back to dashboard</Button>
      </Link>
    </div>
  );
}

/** Wrap a page body in this when the whole screen belongs to an optional module. */
export function FeatureGate({ feature, children }: { feature: string; children: React.ReactNode }) {
  const { hasFeature } = useStore();
  if (!hasFeature(feature)) {
    return (
      <div className="grid place-items-center py-20 text-center">
        <Sparkles size={30} className="mb-3 text-ink-300" />
        <p className="text-sm font-medium text-ink-800">This module is not unlocked for your hospital</p>
        <p className="mt-1 max-w-sm text-xs text-ink-500">
          Turn it on in Plan &amp; usage — it appears in the sidebar for everyone with the right role immediately.
        </p>
        <Link href="/settings/plan" className="mt-4">
          <Button variant="primary" size="sm">Manage modules</Button>
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}
