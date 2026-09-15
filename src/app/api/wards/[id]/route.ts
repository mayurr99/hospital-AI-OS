import { body, handler } from "@/lib/server/route";
import { requireOrg } from "@/lib/server/auth";
import { closeWard, updateWard } from "@/lib/server/admissions";

export async function PATCH(req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const ctx = await requireOrg("org.configure");
    const input = await body<Record<string, unknown>>(req);
    return { ok: true, ward: updateWard(ctx, id, input) };
  });
}

/**
 * Closes a ward rather than deleting it.
 *
 * A discharged patient's record names the ward they were in. Deleting the row
 * would leave that record pointing at nothing, so the ward is deactivated and
 * its beds with it — and the call is refused outright while anyone is still in
 * there.
 */
export async function DELETE(_req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const ctx = await requireOrg("org.configure");
    return closeWard(ctx, id);
  });
}
