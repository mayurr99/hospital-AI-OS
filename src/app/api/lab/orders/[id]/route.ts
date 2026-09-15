import { body, handler } from "@/lib/server/route";
import { requireOrg, HttpError } from "@/lib/server/auth";
import {
  cancelLabOrder, collectSample, enterResults, getLabOrder, releaseResults, startProcessing, verifyResults,
} from "@/lib/server/labs";

export async function GET(_req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const { orgId } = await requireOrg("labs.manage");
    return { order: getLabOrder(orgId, id) };
  });
}

/**
 * POST /api/lab/orders/:id with an `action`:
 *   collect · process · results · verify · release · cancel
 * Each step checks the permission for that step, so entering a result and
 * verifying it are genuinely separable duties.
 */
export async function POST(req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const input = await body<Record<string, unknown>>(req);
    const action = String(input.action ?? "");

    if (action === "collect") {
      const ctx = await requireOrg("labs.collect");
      return { ok: true, order: collectSample(ctx, id, { specimen: input.specimen as string }) };
    }
    if (action === "process") {
      const ctx = await requireOrg("labs.result");
      return { ok: true, order: startProcessing(ctx, id) };
    }
    if (action === "results") {
      const ctx = await requireOrg("labs.result");
      const entries = (input.entries as { analyteCode: string; value: string }[]) ?? [];
      if (!entries.length) throw new HttpError(422, "Enter at least one result value");
      return { ok: true, order: enterResults(ctx, id, entries, String(input.amendReason ?? "")) };
    }
    if (action === "verify") {
      const ctx = await requireOrg("labs.verify");
      return { ok: true, order: verifyResults(ctx, id, String(input.note ?? "")) };
    }
    if (action === "release") {
      const ctx = await requireOrg("labs.verify");
      return { ok: true, order: releaseResults(ctx, id) };
    }
    if (action === "cancel") {
      const ctx = await requireOrg("labs.manage");
      return { ok: true, order: cancelLabOrder(ctx, id, String(input.reason ?? "")) };
    }
    throw new HttpError(400, "Unknown action. Use collect, process, results, verify, release or cancel.");
  });
}
