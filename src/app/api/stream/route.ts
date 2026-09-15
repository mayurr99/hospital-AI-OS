import { getSession } from "@/lib/server/auth";
import { since, subscribe, type Change } from "@/lib/server/realtime";

/**
 * GET /api/stream — server-sent events for the signed-in user's hospital.
 *
 * The tenant comes from the session, never from the request, so a client cannot
 * subscribe to another hospital by editing a URL. The payload carries no patient
 * data (see `realtime.ts`): each message says what changed and the client
 * refetches through the permission-checked endpoints.
 *
 * SSE rather than WebSockets because this traffic is one-directional and SSE
 * reconnects on its own, survives proxies that only speak HTTP, and needs no
 * second server.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.orgId) {
    return new Response("event: unauthorized\ndata: {}\n\n", {
      status: 401,
      headers: { "Content-Type": "text/event-stream" },
    });
  }
  const orgId = session.orgId;

  /* A client resuming after a dropped connection tells us where it got to. */
  const lastEventId = Number(
    req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("since") ?? 0,
  );

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const write = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
        }
      };

      const send = (c: Change) => write(`id: ${c.seq}\nevent: change\ndata: ${JSON.stringify(c)}\n\n`);

      /* Tell the client the stream is live before anything else, so it can show
         a connected state rather than guessing from the absence of errors. */
      write(`event: ready\ndata: ${JSON.stringify({ orgId, at: new Date().toISOString() })}\n\n`);

      /* Replay anything missed while the connection was down. */
      if (Number.isFinite(lastEventId) && lastEventId > 0) {
        for (const c of since(orgId, lastEventId)) send(c);
      }

      unsubscribe = subscribe(orgId, send);

      /*
       * A comment line every 25 seconds. Proxies and load balancers close idle
       * connections, and without this the stream dies quietly — which looks
       * exactly like "nothing is happening in the hospital".
       */
      heartbeat = setInterval(() => write(`: keep-alive ${Date.now()}\n\n`), 25_000);

      req.signal.addEventListener("abort", () => {
        open = false;
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      /* Nginx buffers proxied responses by default, which defeats streaming. */
      "X-Accel-Buffering": "no",
    },
  });
}
