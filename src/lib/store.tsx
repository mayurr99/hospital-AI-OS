"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as seed from "./seed";
import type {
  Agent, Appointment, AuditLog, Bed, CallSession, Campaign, Department, Drug, EmergencyCase, Escalation,
  Facility, Integration, Invoice, LabOrder, ImportJob, Organization, OTSlot, Patient, Permission, Protocol,
  Provider, Role, Task, TelephonyConfig, Thread, User, Ward,
} from "./types";
import { can as rbacCan } from "./rbac";
import { readJson } from "./http";
import { useLiveChanges, type LiveStatus } from "./live";

/* ------------------------------------------------------------------ */
/* shapes served by /api/bootstrap                                     */
/* ------------------------------------------------------------------ */

export interface Subscription {
  orgId: string;
  plan: string;
  status: "trialing" | "active" | "trial_expired" | "past_due" | string;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  seats: number;
  voiceMinutesCap: number;
  voiceMinutesUsed: number;
  monthlyFee: number;
  features: string[];
}

export interface FeatureDef {
  key: string;
  label: string;
  group: string;
  blurb: string;
}

export interface RecordingMeta {
  id: string;
  callId: string;
  patientId: string | null;
  storageKind: "local" | "s3";
  storageKey: string;
  bytes: number;
  durationSeconds: number;
  mime: string;
  consent: boolean;
  retentionUntil: string | null;
  createdAt: string;
}

export interface ExportJob {
  id: string;
  requestedBy: string;
  template: string;
  scope: Record<string, unknown>;
  status: string;
  rows: number;
  bytes: number;
  downloadToken: string | null;
  expiresAt: string | null;
  downloadedAt: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface OrgSummary {
  id: string;
  name: string;
  shortName: string;
  city: string;
  accentColor: string;
  logoInitials: string;
  status: string;
  plan: string;
  deployment: string;
  isDemo: boolean;
  createdAt: string;
}

type Collections = {
  facility: Facility[];
  department: Department[];
  provider: Provider[];
  patient: Patient[];
  appointment: Appointment[];
  call: CallSession[];
  escalation: Escalation[];
  task: Task[];
  campaign: Campaign[];
  agent: Agent[];
  protocol: Protocol[];
  ward: Ward[];
  bed: Bed[];
  otSlot: OTSlot[];
  drug: Drug[];
  labOrder: LabOrder[];
  emergencyCase: EmergencyCase[];
  invoice: Invoice[];
  thread: Thread[];
  importJob: ImportJob[];
  integration: Integration[];
};

export type RecordKind = keyof Collections;

const EMPTY: Collections = {
  facility: [], department: [], provider: [], patient: [], appointment: [], call: [], escalation: [],
  task: [], campaign: [], agent: [], protocol: [], ward: [], bed: [], otSlot: [], drug: [], labOrder: [],
  emergencyCase: [], invoice: [], thread: [], importJob: [], integration: [],
};

/* ------------------------------------------------------------------ */
/* context                                                             */
/* ------------------------------------------------------------------ */

/** Counts the chrome needs before any collection has loaded. */
export interface Badges {
  escalations: number;
  tasks: number;
  messages: number;
  criticalLabs: number;
  patients: number;
  occupiedBeds: number;
  totalBeds: number;
}

interface Ctx {
  ready: boolean;
  /** True once the tenant's lists have arrived — screens use it for skeletons. */
  dataReady: boolean;
  /** Whether this workspace is receiving live updates from the hospital. */
  liveStatus: LiveStatus;
  badges: Badges | null;
  authenticated: boolean;
  currentUser: User | null;
  org: (Organization & { isDemo?: boolean }) | null;
  organizations: OrgSummary[];
  activeOrgId: string | null;
  subscription: Subscription | null;
  featureCatalog: FeatureDef[];
  settings: Record<string, unknown>;
  users: User[];
  auditLogs: AuditLog[];
  recordings: RecordingMeta[];
  exports: ExportJob[];
  collections: Collections;
  toast: string | null;

  can: (p: Permission) => boolean;
  hasFeature: (key: string) => boolean;
  notify: (msg: string) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setActiveOrg: (orgId: string, justification?: string) => Promise<void>;

  /* generic, tenant-safe record operations */
  createRecord: <K extends RecordKind>(kind: K, value: Partial<Collections[K][number]>) => Promise<Collections[K][number] | null>;
  updateRecord: <K extends RecordKind>(kind: K, id: string, patch: Partial<Collections[K][number]>) => Promise<void>;
  deleteRecord: (kind: RecordKind, id: string) => Promise<void>;

  /* user management */
  inviteUser: (input: Partial<User> & { name: string; email: string; role: Role; password?: string }) => Promise<User | null>;
  saveUser: (id: string, patch: Partial<User> & { password?: string }) => Promise<void>;
  removeUser: (id: string) => Promise<void>;

  /* settings */
  saveSetting: (key: string, value: unknown) => Promise<void>;
  testConnection: (target: "storage" | "retell" | "elevenlabs") => Promise<{ ok: boolean; detail: string; simulated?: boolean }>;

  /* voice */
  startCall: (patientId: string, agentType: "care" | "receptionist") => Promise<{ providerCallId: string; simulated: boolean; detail?: string } | null>;
  finalizeCall: (patientId: string, agentType: "care" | "receptionist", payload: Record<string, unknown>) => Promise<CallSession | null>;
  forwardCritical: (input: { patientId: string; providerCallId?: string; trigger: string; detail?: string; callId?: string }) => Promise<ForwardResult | null>;

  /* exports */
  createExport: (template: string, opts: { maskPhone: boolean; includeClinical: boolean; days?: number }) => Promise<{ downloadUrl: string; rows: number } | null>;

  /* convenience aliases kept so existing screens are unchanged */
  patients: Patient[];
  appointments: Appointment[];
  calls: CallSession[];
  escalations: Escalation[];
  tasks: Task[];
  campaigns: Campaign[];
  agents: Agent[];
  protocols: Protocol[];
  beds: Bed[];
  otSlots: OTSlot[];
  drugs: Drug[];
  labOrders: LabOrder[];
  emergencyCases: EmergencyCase[];
  invoices: Invoice[];
  threads: Thread[];
  audit: (action: string, target: string, severity?: AuditLog["severity"]) => void;
  bookAppointment: (a: Omit<Appointment, "id" | "createdAt">) => Appointment;
  updateAppointment: (id: string, patch: Partial<Appointment>) => void;
  addCall: (c: CallSession) => void;
  reviewCall: (id: string) => void;
  acknowledgeEscalation: (id: string) => void;
  resolveEscalation: (id: string, note: string) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  upsertUser: (u: User) => void;
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  updateCampaign: (id: string, patch: Partial<Campaign>) => void;
  updateBed: (id: string, patch: Partial<Bed>) => void;
  updateOt: (id: string, patch: Partial<OTSlot>) => void;
  updateDrug: (id: string, patch: Partial<Drug>) => void;
  updateLab: (id: string, patch: Partial<LabOrder>) => void;
  updateEmergency: (id: string, patch: Partial<EmergencyCase>) => void;
  updateInvoice: (id: string, patch: Partial<Invoice>) => void;
  updateProtocol: (id: string, patch: Partial<Protocol>) => void;
  updatePatient: (id: string, patch: Partial<Patient>) => void;
  sendMessage: (threadId: string, body: string, handledBy: "ai" | "staff") => void;
}

export interface ForwardResult {
  ok: boolean;
  connectedTo: string | null;
  transferMode: string;
  afterHours: boolean;
  slaMinutes: number;
  escalationId: string;
  taskId: string;
  simulated: boolean;
  steps: { step: string; ok: boolean; detail: string }[];
}

const StoreContext = createContext<Ctx | null>(null);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await readJson<{ error?: string }>(res);
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [org, setOrg] = useState<Ctx["org"]>(null);
  const [organizations, setOrganizations] = useState<OrgSummary[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [featureCatalog, setFeatureCatalog] = useState<FeatureDef[]>([]);
  const [settingsState, setSettingsState] = useState<Record<string, unknown>>({});
  const [users, setUsers] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [collections, setCollections] = useState<Collections>(EMPTY);
  /** `ready` means the shell can render; `dataReady` means the lists have landed. */
  const [dataReady, setDataReady] = useState(false);
  const collectionsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [badges, setBadges] = useState<Ctx["badges"]>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3600);
  }, []);

  /**
   * The tenant's working data, fetched *after* the shell so the sidebar, header
   * and page frame appear immediately rather than waiting on the whole dataset.
   * Screens read `collections` exactly as before; they simply see it fill in.
   */
  const loadCollections = useCallback(async () => {
    try {
      const data = await api<Record<string, unknown>>("/api/collections");
      if (!data.authenticated) return;
      setAuditLogs((data.auditLogs as AuditLog[]) ?? []);
      setRecordings((data.recordings as RecordingMeta[]) ?? []);
      setExportJobs((data.exports as ExportJob[]) ?? []);
      const next = { ...EMPTY } as Record<string, unknown[]>;
      for (const key of Object.keys(EMPTY)) next[key] = (data[key] as unknown[]) ?? [];
      setCollections(next as unknown as Collections);
    } catch {
      /* The shell stays usable; the screen that needs a collection shows its own
         empty state rather than the whole workspace failing to open. */
    } finally {
      setDataReady(true);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api<Record<string, unknown>>("/api/bootstrap");
      if (!data.authenticated) {
        setAuthenticated(false);
        setCurrentUser(null);
        setReady(true);
        return;
      }
      setAuthenticated(true);
      setCurrentUser(data.user as User);
      setOrg((data.org as Ctx["org"]) ?? null);
      setOrganizations((data.organizations as OrgSummary[]) ?? []);
      setSubscription((data.subscription as Subscription) ?? null);
      setFeatureCatalog((data.featureCatalog as FeatureDef[]) ?? []);
      setSettingsState((data.settings as Record<string, unknown>) ?? {});
      setUsers((data.users as User[]) ?? []);
      setBadges((data.badges as Ctx["badges"]) ?? null);
      setReady(true);           /* paint the shell now */
      await loadCollections();  /* fill the screens in a moment */
    } catch {
      setAuthenticated(false);
    } finally {
      setReady(true);
    }
  }, [loadCollections]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /*
   * Live updates.
   *
   * The workspace keeps the tenant's lists in memory, which is what makes the
   * screens fast — and what made them go stale the moment a colleague changed
   * something. The stream tells us which kind of thing changed; we refetch the
   * lists rather than trusting a payload, so every permission rule stays on the
   * server. Bursts are coalesced, because one transfer touches four tables.
   */
  const liveStatus = useLiveChanges(undefined, useCallback((c) => {
    /* Badge counts are cheap and worth keeping exact. */
    if (c.topic === "critical" || c.topic === "escalation" || c.topic === "task") {
      void api<Record<string, unknown>>("/api/bootstrap")
        .then((d) => { if (d.authenticated) setBadges((d.badges as Badges) ?? null); })
        .catch(() => {});
    }
    if (collectionsTimer.current) clearTimeout(collectionsTimer.current);
    collectionsTimer.current = setTimeout(() => { void loadCollections(); }, 600);
  }, [loadCollections]), authenticated);

  const can = useCallback((p: Permission) => rbacCan(currentUser, p), [currentUser]);

  const hasFeature = useCallback(
    (key: string) => {
      if (!subscription) return true;
      if (!subscription.features.length) return true;
      return subscription.features.includes(key);
    },
    [subscription],
  );

  /* ------------------------- generic records ------------------------ */

  const applyLocal = useCallback(<K extends RecordKind>(kind: K, updater: (prev: Collections[K]) => Collections[K]) => {
    setCollections((prev) => ({ ...prev, [kind]: updater(prev[kind]) }));
  }, []);

  const createRecord = useCallback(
    async <K extends RecordKind>(kind: K, value: Partial<Collections[K][number]>) => {
      try {
        const res = await api<{ record: Collections[K][number] }>(`/api/records/${kind}`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        applyLocal(kind, (prev) => [res.record, ...prev] as Collections[K]);
        return res.record;
      } catch (e) {
        notify(e instanceof Error ? e.message : "Could not save");
        return null;
      }
    },
    [applyLocal, notify],
  );

  const updateRecord = useCallback(
    async <K extends RecordKind>(kind: K, id: string, patch: Partial<Collections[K][number]>) => {
      applyLocal(kind, (prev) => prev.map((r) => ((r as { id: string }).id === id ? { ...r, ...patch } : r)) as Collections[K]);
      try {
        await api(`/api/records/${kind}/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      } catch (e) {
        notify(e instanceof Error ? e.message : "Could not save — reloading");
        void refresh();
      }
    },
    [applyLocal, notify, refresh],
  );

  const deleteRecord = useCallback(
    async (kind: RecordKind, id: string) => {
      const before = collections[kind];
      applyLocal(kind, (prev) => prev.filter((r) => (r as { id: string }).id !== id) as Collections[typeof kind]);
      try {
        await api(`/api/records/${kind}/${id}`, { method: "DELETE" });
      } catch (e) {
        notify(e instanceof Error ? e.message : "Could not delete");
        setCollections((prev) => ({ ...prev, [kind]: before }));
      }
    },
    [applyLocal, collections, notify],
  );

  /* ---------------------------- auth / org -------------------------- */

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthenticated(false);
    setCurrentUser(null);
    setOrg(null);
    setCollections(EMPTY);
  }, []);

  const setActiveOrg = useCallback(
    async (orgId: string, justification?: string) => {
      try {
        await api("/api/auth/switch-org", { method: "POST", body: JSON.stringify({ orgId, justification }) });
        await refresh();
      } catch (e) {
        notify(e instanceof Error ? e.message : "Could not switch hospital");
      }
    },
    [notify, refresh],
  );

  /* ------------------------------ users ----------------------------- */

  const inviteUser = useCallback(
    async (input: Partial<User> & { name: string; email: string; role: Role; password?: string }) => {
      try {
        const res = await api<{ user: User }>("/api/users", { method: "POST", body: JSON.stringify(input) });
        setUsers((prev) => [res.user, ...prev]);
        return res.user;
      } catch (e) {
        notify(e instanceof Error ? e.message : "Could not invite user");
        return null;
      }
    },
    [notify],
  );

  const saveUser = useCallback(
    async (id: string, patch: Partial<User> & { password?: string }) => {
      setUsers((prev) => prev.map((u) => (u.id === id ? ({ ...u, ...patch } as User) : u)));
      try {
        await api(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      } catch (e) {
        notify(e instanceof Error ? e.message : "Could not update user");
        void refresh();
      }
    },
    [notify, refresh],
  );

  const removeUser = useCallback(
    async (id: string) => {
      const before = users;
      setUsers((prev) => prev.filter((u) => u.id !== id));
      try {
        await api(`/api/users/${id}`, { method: "DELETE" });
      } catch (e) {
        notify(e instanceof Error ? e.message : "Could not remove user");
        setUsers(before);
      }
    },
    [notify, users],
  );

  /* ---------------------------- settings ---------------------------- */

  const saveSetting = useCallback(
    async (key: string, value: unknown) => {
      try {
        const res = await api<{ value: unknown }>(`/api/settings/${key}`, { method: "PUT", body: JSON.stringify({ value }) });
        setSettingsState((prev) => ({ ...prev, [key]: res.value }));
      } catch (e) {
        notify(e instanceof Error ? e.message : "Could not save settings");
      }
    },
    [notify],
  );

  const testConnection = useCallback(async (target: "storage" | "retell" | "elevenlabs") => {
    try {
      return await api<{ ok: boolean; detail: string; simulated?: boolean }>("/api/settings/test", {
        method: "POST",
        body: JSON.stringify({ target }),
      });
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : "Test failed" };
    }
  }, []);

  /* ------------------------------ voice ----------------------------- */

  const startCall = useCallback(
    async (patientId: string, agentType: "care" | "receptionist") => {
      try {
        return await api<{ providerCallId: string; simulated: boolean; detail?: string }>("/api/voice/call", {
          method: "POST",
          body: JSON.stringify({ patientId, agentType }),
        });
      } catch (e) {
        notify(e instanceof Error ? e.message : "Could not start the call");
        return null;
      }
    },
    [notify],
  );

  const finalizeCall = useCallback(
    async (patientId: string, agentType: "care" | "receptionist", payload: Record<string, unknown>) => {
      try {
        const res = await api<{ call: CallSession }>("/api/voice/call", {
          method: "POST",
          body: JSON.stringify({ patientId, agentType, finalize: payload }),
        });
        applyLocal("call", (prev) => [res.call, ...prev]);
        void refresh();
        return res.call;
      } catch (e) {
        notify(e instanceof Error ? e.message : "Could not save the call");
        return null;
      }
    },
    [applyLocal, notify, refresh],
  );

  const forwardCritical = useCallback(
    async (input: { patientId: string; providerCallId?: string; trigger: string; detail?: string; callId?: string }) => {
      try {
        const res = await api<ForwardResult>("/api/voice/forward", { method: "POST", body: JSON.stringify(input) });
        void refresh();
        return res;
      } catch (e) {
        notify(e instanceof Error ? e.message : "Forwarding failed");
        return null;
      }
    },
    [notify, refresh],
  );

  /* ----------------------------- exports ---------------------------- */

  const createExport = useCallback(
    async (template: string, opts: { maskPhone: boolean; includeClinical: boolean; days?: number }) => {
      try {
        const res = await api<{ downloadUrl: string; job: { rows: number } }>("/api/exports", {
          method: "POST",
          body: JSON.stringify({ template, ...opts }),
        });
        void refresh();
        return { downloadUrl: res.downloadUrl, rows: res.job.rows };
      } catch (e) {
        notify(e instanceof Error ? e.message : "Export failed");
        return null;
      }
    },
    [notify, refresh],
  );

  /* --------------- aliases preserving the original screens ---------- */

  const audit = useCallback(() => {
    /* audit is written server-side on every mutation; this keeps older call sites harmless */
  }, []);

  const bookAppointment = useCallback(
    (a: Omit<Appointment, "id" | "createdAt">) => {
      const optimistic: Appointment = { ...a, id: `apt_tmp_${Date.now()}`, createdAt: new Date().toISOString() };
      applyLocal("appointment", (prev) => [optimistic, ...prev]);
      void createRecord("appointment", { ...a, createdAt: optimistic.createdAt } as Partial<Appointment>).then((rec) => {
        if (rec) applyLocal("appointment", (prev) => prev.filter((x) => x.id !== optimistic.id));
      });
      return optimistic;
    },
    [applyLocal, createRecord],
  );

  const value: Ctx = {
    ready, dataReady, liveStatus, badges, authenticated, currentUser, org, organizations, activeOrgId: org?.id ?? null, subscription,
    featureCatalog, settings: settingsState, users, auditLogs, recordings, exports: exportJobs, collections, toast,
    can, hasFeature, notify, refresh, logout, setActiveOrg,
    createRecord, updateRecord, deleteRecord,
    inviteUser, saveUser, removeUser,
    saveSetting, testConnection,
    startCall, finalizeCall, forwardCritical,
    createExport,

    patients: collections.patient,
    appointments: collections.appointment,
    calls: collections.call,
    escalations: collections.escalation,
    tasks: collections.task,
    campaigns: collections.campaign,
    agents: collections.agent,
    protocols: collections.protocol,
    beds: collections.bed,
    otSlots: collections.otSlot,
    drugs: collections.drug,
    labOrders: collections.labOrder,
    emergencyCases: collections.emergencyCase,
    invoices: collections.invoice,
    threads: collections.thread,

    audit,
    bookAppointment,
    updateAppointment: (id, patch) => void updateRecord("appointment", id, patch),
    addCall: (c) => applyLocal("call", (prev) => [c, ...prev]),
    reviewCall: (id) => void updateRecord("call", id, { reviewStatus: "reviewed" } as Partial<CallSession>),
    acknowledgeEscalation: (id) =>
      void updateRecord("escalation", id, { status: "acknowledged", acknowledgedAt: new Date().toISOString() } as Partial<Escalation>),
    resolveEscalation: (id, note) =>
      void updateRecord("escalation", id, { status: "resolved", resolvedAt: new Date().toISOString(), resolutionNote: note } as Partial<Escalation>),
    updateTask: (id, patch) => void updateRecord("task", id, patch),
    upsertUser: (u) => void saveUser(u.id, u),
    updateAgent: (id, patch) => void updateRecord("agent", id, patch),
    updateCampaign: (id, patch) => void updateRecord("campaign", id, patch),
    updateBed: (id, patch) => void updateRecord("bed", id, patch),
    updateOt: (id, patch) => void updateRecord("otSlot", id, patch),
    updateDrug: (id, patch) => void updateRecord("drug", id, patch),
    updateLab: (id, patch) => void updateRecord("labOrder", id, patch),
    updateEmergency: (id, patch) => void updateRecord("emergencyCase", id, patch),
    updateInvoice: (id, patch) => void updateRecord("invoice", id, patch),
    updateProtocol: (id, patch) => void updateRecord("protocol", id, patch),
    updatePatient: (id, patch) => void updateRecord("patient", id, patch),
    sendMessage: (threadId, bodyText, handledBy) => {
      const thread = collections.thread.find((t) => t.id === threadId);
      if (!thread) return;
      const next = {
        ...thread,
        lastAt: new Date().toISOString(),
        unread: 0,
        messages: [
          ...thread.messages,
          {
            id: `msg_${Date.now()}`, orgId: thread.orgId, patientId: thread.patientId, channel: thread.channel,
            direction: "out" as const, body: bodyText, at: new Date().toISOString(),
            status: "sent" as const, handledBy,
          },
        ],
      };
      void updateRecord("thread", threadId, next as Partial<Thread>);
    },
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}

/** Everything for the active tenant, in the shape the screens already expect. */
export function useOrgData() {
  const s = useStore();
  return useMemo(() => {
    const c = s.collections;
    const telephony = (s.settings.telephony as TelephonyConfig | null) ?? {
      orgId: s.org?.id ?? "",
      provider: "Built-in simulator",
      aiNumber: "",
      fallbackNumber: "",
      transferDestinations: [],
      concurrentChannels: 10,
      sipTrunk: "—",
      status: "connected" as const,
      recordingStorage: "Local encrypted volume",
    };
    return {
      patients: c.patient,
      appointments: c.appointment,
      calls: c.call,
      escalations: c.escalation,
      tasks: c.task,
      campaigns: c.campaign,
      agents: c.agent,
      protocols: c.protocol,
      beds: c.bed,
      otSlots: c.otSlot,
      drugs: c.drug,
      labOrders: c.labOrder,
      emergencyCases: c.emergencyCase,
      invoices: c.invoice,
      threads: c.thread,
      importJobs: c.importJob,
      integrations: c.integration,
      facilities: c.facility,
      departments: c.department,
      providers: c.provider,
      wards: c.ward,
      users: s.users,
      auditLogs: s.auditLogs,
      recordings: s.recordings,
      exports: s.exports,
      telephony,
      series: (s.settings["analytics.series"] as { date: string; calls: number; connected: number; completed: number; booked: number; escalations: number; noShow: number; minutes: number }[]) ?? [],
      knowledge: (s.settings.knowledge as { q: string; a: string; tags: string[]; approvedBy: string; version: string }[]) ?? [],
    };
  }, [s.collections, s.users, s.auditLogs, s.recordings, s.exports, s.settings, s.org]);
}

export { seed };
