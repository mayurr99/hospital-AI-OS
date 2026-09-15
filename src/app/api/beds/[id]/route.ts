import { body, handler } from "@/lib/server/route";
import { requireOrg } from "@/lib/server/auth";
import { retireBed, setBedStatus, updateBed, type BedStatus } from "@/lib/server/admissions";

/**
 * A status change and an edit are different operations with different rules.
 *
 * Housekeeping status — cleaning, maintenance, blocked — goes through
 * `setBedStatus`, which refuses to mark a bed occupied by hand: occupancy is a
 * consequence of an admission and nothing else. Renaming a bed or changing its
 * daily rate is an ordinary edit and has no business going through that path.
 */
export async function PATCH(req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const ctx = await requireOrg("ipd.manage");
    const input = await body<Record<string, unknown>>(req);

    if (input.status !== undefined) {
      return { ok: true, bed: setBedStatus(ctx, id, input.status as BedStatus, String(input.note ?? "")) };
    }
    return {
      ok: true,
      bed: updateBed(ctx, id, {
        number: input.number as string | undefined,
        dailyRate: input.dailyRate === undefined ? undefined : Number(input.dailyRate),
        note: input.note as string | undefined,
      }),
    };
  });
}

/** Retires the bed. Refused while a patient is in it — see `retireBed`. */
export async function DELETE(_req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const ctx = await requireOrg("ipd.manage");
    return retireBed(ctx, id);
  });
}
