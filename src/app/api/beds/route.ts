import { body, handler } from "@/lib/server/route";
import { requireOrg } from "@/lib/server/auth";
import { createBed, createBedRun, listBeds } from "@/lib/server/admissions";

export async function GET(req: Request) {
  return handler(async () => {
    const { orgId } = await requireOrg("patients.view");
    const wardId = new URL(req.url).searchParams.get("wardId") ?? undefined;
    return { items: listBeds(orgId, wardId) };
  });
}

/**
 * Add a bed, or a run of them.
 *
 * Sending `from` and `to` creates the whole run in one transaction — "ICU-01"
 * through "ICU-12" — because a forty-bed ward set up one bed at a time is how a
 * hospital ends up with a half-configured ward and a receptionist who cannot
 * admit anybody.
 */
export async function POST(req: Request) {
  return handler(async () => {
    const ctx = await requireOrg("ipd.manage");
    const input = await body<Record<string, unknown>>(req);

    if (input.from !== undefined && input.to !== undefined) {
      const run = createBedRun(ctx, {
        wardId: String(input.wardId ?? ""),
        prefix: String(input.prefix ?? ""),
        from: Number(input.from),
        to: Number(input.to),
        pad: input.pad === undefined ? undefined : Number(input.pad),
        dailyRate: input.dailyRate === undefined ? undefined : Number(input.dailyRate),
      });
      return {
        ok: true,
        beds: run.created,
        created: run.created.length,
        /* Named, not just counted — "3 skipped" leaves somebody hunting. */
        skipped: run.skipped,
      };
    }

    return {
      ok: true,
      bed: createBed(ctx, {
        wardId: String(input.wardId ?? ""),
        number: String(input.number ?? ""),
        dailyRate: input.dailyRate === undefined ? undefined : Number(input.dailyRate),
        roomId: (input.roomId as string) ?? null,
        note: input.note as string | undefined,
      }),
    };
  });
}
