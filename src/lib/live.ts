"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The client half of live updates.
 *
 * Subscribes to `/api/stream` and tells the caller when something it cares
 * about has changed. The stream carries no patient data by design (see
 * `server/realtime.ts`), so the reaction to an event is always "refetch the
 * thing that changed" — which keeps every permission rule in one place, on the
 * server.
 *
 * Notes that matter in a hospital:
 *
 *  - The browser's own EventSource reconnects automatically, and we replay
 *    missed events using `Last-Event-ID`, so a laptop that sleeps through a
 *    ward round catches up rather than showing yesterday's board.
 *  - Events caused by *this* user are still delivered, because a second tab or
 *    a second device belonging to the same person still needs them; callers
 *    that do optimistic updates can ignore their own by comparing `actorId`.
 *  - A hidden tab disconnects. Over HTTP/1.1 a browser allows only six
 *    connections per origin, and an open stream holds one of them for as long
 *    as the tab lives — so someone with several tabs of the workspace open
 *    would find the next one unable to load anything at all. Disconnecting a
 *    backgrounded tab frees its connection, and the tab resyncs when it is
 *    looked at again. (Over HTTP/2, which any TLS deployment uses, the limit is
 *    far higher and this is simply good manners.)
 */

export type ChangeTopic =
  | "patient" | "admission" | "bed" | "lab" | "critical"
  | "vitals" | "medication" | "encounter" | "billing" | "escalation" | "task";

export interface Change {
  seq: number;
  topic: ChangeTopic;
  entityId?: string;
  patientId?: string;
  action: string;
  actorId?: string;
  at: string;
}

export type LiveStatus = "connecting" | "live" | "offline";

/**
 * Watch the hospital's change stream.
 *
 * @param topics  which topics to react to; omit for all
 * @param onChange called for each matching change
 */
export function useLiveChanges(
  topics: ChangeTopic[] | undefined,
  onChange: (c: Change) => void,
  /**
   * Only connect once there is a session to connect with. Opening the stream on
   * the login page produces a 401 the browser logs as a console error, which is
   * noise in every developer console and in the test suites — and an EventSource
   * that starts life rejected then retries on a backoff for no reason.
   */
  enabled = true,
): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  /* Held in a ref so changing the handler never tears down the connection. */
  const handler = useRef(onChange);
  handler.current = onChange;
  const wanted = useRef<Set<ChangeTopic> | null>(null);
  wanted.current = topics?.length ? new Set(topics) : null;

  useEffect(() => {
    if (!enabled) {
      setStatus("connecting");
      return;
    }
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;

    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let release: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let attempts = 0;
    let lastSeq = 0;

    const connect = () => {
      if (closed) return;
      /* `since` lets the server replay what we missed; EventSource sends
         Last-Event-ID itself on its own reconnects, and this covers ours. */
      source = new EventSource(`/api/stream${lastSeq ? `?since=${lastSeq}` : ""}`);

      source.addEventListener("ready", () => {
        attempts = 0;
        setStatus("live");
      });

      source.addEventListener("change", (e) => {
        try {
          const c = JSON.parse((e as MessageEvent).data) as Change;
          if (c.seq > lastSeq) lastSeq = c.seq;
          if (!wanted.current || wanted.current.has(c.topic)) handler.current(c);
        } catch {
          /* a malformed frame must not kill the stream */
        }
      });

      source.onerror = () => {
        setStatus("offline");
        source?.close();
        source = null;
        if (closed) return;
        /*
         * Back off, but never beyond 30s: a ward board that gives up
         * reconnecting is worse than one that retries a little too often.
         */
        attempts += 1;
        const wait = Math.min(1000 * 2 ** Math.min(attempts, 5), 30_000);
        retry = setTimeout(connect, wait);
      };
    };

    connect();

    /*
     * Hidden tabs let go of the connection; visible ones take it back at once
     * rather than waiting for the next backoff tick. The delay before releasing
     * stops a quick alt-tab from churning the connection.
     */
    const onVisible = () => {
      if (closed) return;
      if (document.visibilityState === "visible") {
        if (release) { clearTimeout(release); release = null; }
        if (!source) {
          if (retry) clearTimeout(retry);
          attempts = 0;
          connect();
        }
      } else {
        release = setTimeout(() => {
          source?.close();
          source = null;
          setStatus("offline");
        }, 60_000);
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (retry) clearTimeout(retry);
      if (release) clearTimeout(release);
      source?.close();
    };
  }, [enabled]);

  return status;
}

/**
 * Re-run `reload` when any of `topics` changes, coalescing bursts.
 *
 * A transfer writes an admission, a ward assignment and two bed rows in one
 * action; without coalescing a screen would refetch four times in a few
 * milliseconds.
 */
export function useLiveReload(
  topics: ChangeTopic[],
  reload: () => void,
  opts: { debounceMs?: number; patientId?: string; enabled?: boolean } = {},
): LiveStatus {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patientId = opts.patientId;
  const debounce = opts.debounceMs ?? 400;

  return useLiveChanges(topics, (c) => {
    /* A patient chart only cares about its own patient. */
    if (patientId && c.patientId && c.patientId !== patientId) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => reloadRef.current(), debounce);
  }, opts.enabled ?? true);
}
