import { body, handler } from "@/lib/server/route";
import { requireOrg, HttpError } from "@/lib/server/auth";
import { acknowledgeCritical, markNotified } from "@/lib/server/labs";

/**
 * A critical result is routed to a named human. No AI agent acknowledges,
 * interprets or acts on it.
 */
export async function POST(req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const input = await body<Record<string, unknown>>(req);
    const action = String(input.action ?? "");

    if (action === "notify") {
      const ctx = await requireOrg("labs.result");
      markNotified(ctx, id, String(input.to ?? ""), String(input.channel ?? "phone"));
      return { ok: true };
    }
    if (action === "acknowledge") {
      const ctx = await requireOrg("escalations.resolve");
      acknowledgeCritical(ctx, id, String(input.note ?? ""));
      return { ok: true };
    }
    throw new HttpError(400, "Unknown action. Use notify or acknowledge.");
  });
}
