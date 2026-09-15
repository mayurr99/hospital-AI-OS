import { body, handler } from "@/lib/server/route";
import { requireOrg } from "@/lib/server/auth";
import { stopMedication } from "@/lib/server/clinicaldata";

/** Medication orders are stopped or corrected — there is no DELETE. */
export async function PATCH(req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const ctx = await requireOrg("prescriptions.write");
    /* The status is validated inside stopMedication, against the same list the
       database CHECK constraint uses — a type here would not survive runtime. */
    const input = await body<{ status?: unknown; reason?: string }>(req);
    stopMedication(ctx, id, input.reason ?? "", input.status ?? "STOPPED");
    return { ok: true };
  });
}
