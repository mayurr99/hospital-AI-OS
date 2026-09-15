import { body, handler } from "@/lib/server/route";
import { requireOrg } from "@/lib/server/auth";
import { addAllergy, listAllergies, retireAllergy, assertPatientInOrg } from "@/lib/server/patients";

export async function GET(_req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const { orgId } = await requireOrg("patients.clinical.view");
    /* The patient must be this hospital's before any of it is read or written. */
    assertPatientInOrg(orgId, id);
    return { items: listAllergies(orgId, id, true) };
  });
}

export async function POST(req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const ctx = await requireOrg("encounters.write");
    /* The patient must be this hospital's before any of it is read or written. */
    assertPatientInOrg(ctx.orgId, id);
    const input = await body<{ substance: string; category?: string; reaction?: string; severity?: string; note?: string }>(req);
    if (!input.substance?.trim()) throw new (await import("@/lib/server/auth")).HttpError(422, "A substance is required");
    return { ok: true, allergy: addAllergy(ctx, id, input) };
  });
}

/** Allergies are retired, never deleted — the record of what was believed stays. */
export async function PATCH(req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const ctx = await requireOrg("encounters.write");
    /* The patient must be this hospital's before any of it is read or written. */
    assertPatientInOrg(ctx.orgId, id);
    const input = await body<{ allergyId: string; status: "inactive" | "entered_in_error"; reason: string }>(req);
    retireAllergy(ctx, id, input.allergyId, input.status, input.reason ?? "");
    return { ok: true, items: listAllergies(ctx.orgId, id, true) };
  });
}
