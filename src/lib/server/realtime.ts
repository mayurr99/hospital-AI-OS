/**
 * Live updates.
 *
 * A hospital is a shared workspace. A nurse assigns a bed, a lab technician
 * verifies a result, a doctor discharges a patient — and until now every other
 * screen in the building kept showing what was true when it was opened. Staff
 * work around that by reloading, which is both friction and a safety problem:
 * the person looking at a stale ward board believes a bed is free.
 *
 * Two deliberate design choices:
 *
 *  1. **The stream carries no patient data.** An event says only *what kind of
 *     thing changed* and *which record*, never a name, a value or a diagnosis.
 *     Subscribers refetch through the normal endpoints, which apply the
 *     permission checks. A stream that carried the data would have to re-derive
 *     every role rule, and the first mistake there is a PHI leak. This way the
 *     stream is structurally incapable of leaking.
 *
 *  2. **Subscriptions are per-tenant, resolved from the session.** A subscriber
 *     receives its own hospital's events and nothing else. The org is never
 *     taken from the request.
 *
 * The bus is in-process, which is correct for the single-node deployment this
 * product ships as. Moving to several nodes means replacing `publish`/
 * `subscribe` with Redis pub/sub or Postgres LISTEN/NOTIFY; nothing else
 * changes, because no caller knows how delivery happens.
 */

/** What changed. Deliberately coarse — the client refetches the detail. */
export type ChangeTopic =
  | "patient"        /* demographics, consent, allergies */
  | "admission"      /* admitted, transferred, discharged */
  | "bed"            /* occupancy or status */
  | "lab"            /* order status, results, verification, release */
  | "critical"       /* a critical result needing acknowledgement */
  | "vitals"
  | "medication"
  | "encounter"
  | "billing"
  | "escalation"
  | "task";

export interface Change {
  /** Monotonic per-process id, used by clients to resume after a reconnect. */
  seq: number;
  topic: ChangeTopic;
  /** The record that changed, so a screen showing exactly that row can refetch just it. */
  entityId?: string;
  /** The patient it concerns, so an open chart knows whether it cares. */
  patientId?: string;
  /** A short verb for logs and for the "what just changed" line in the UI. */
  action: string;
  /** Who caused it, so a client can skip echoing the user's own action back. */
  actorId?: string;
  at: string;
}

type Subscriber = (c: Change) => void;

const subscribers = new Map<string, Set<Subscriber>>();

/**
 * Recent changes per tenant, so a client whose connection dropped for a few
 * seconds catches up instead of silently missing a bed release. Bounded, because
 * this is a convenience for reconnects, not an event store.
 */
const RECENT_CAP = 200;
const recent = new Map<string, Change[]>();

let seq = 0;

/** Publish a change to everyone watching this hospital. */
export function publish(
  orgId: string,
  topic: ChangeTopic,
  action: string,
  meta: { entityId?: string; patientId?: string; actorId?: string } = {},
): void {
  if (!orgId) return;
  const change: Change = {
    seq: ++seq,
    topic,
    action,
    entityId: meta.entityId,
    patientId: meta.patientId,
    actorId: meta.actorId,
    at: new Date().toISOString(),
  };

  const buffer = recent.get(orgId) ?? [];
  buffer.push(change);
  if (buffer.length > RECENT_CAP) buffer.splice(0, buffer.length - RECENT_CAP);
  recent.set(orgId, buffer);

  for (const send of subscribers.get(orgId) ?? []) {
    try {
      send(change);
    } catch {
      /* One broken connection must never stop the others being notified. */
    }
  }
}

/** Changes this tenant has seen since `afterSeq`, for resuming a dropped stream. */
export function since(orgId: string, afterSeq: number): Change[] {
  return (recent.get(orgId) ?? []).filter((c) => c.seq > afterSeq);
}

/** Subscribe to one hospital's changes. Returns the unsubscribe function. */
export function subscribe(orgId: string, fn: Subscriber): () => void {
  const set = subscribers.get(orgId) ?? new Set<Subscriber>();
  set.add(fn);
  subscribers.set(orgId, set);
  return () => {
    set.delete(fn);
    if (!set.size) subscribers.delete(orgId);
  };
}

/** Connected clients per tenant — surfaced in diagnostics, not to end users. */
export function subscriberCount(orgId: string): number {
  return subscribers.get(orgId)?.size ?? 0;
}
