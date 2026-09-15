import { body, handler } from "@/lib/server/route";
import { requireOrg } from "@/lib/server/auth";
import { assertPatientInOrg } from "@/lib/server/patients";
import { listMedications, prescribe } from "@/lib/server/clinicaldata";

export async function GET(_req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const { orgId } = await requireOrg("patients.clinical.view");
    /* The patient must be this hospital's before any of it is read or written. */
    assertPatientInOrg(orgId, id);
    return { items: listMedications(orgId, id) };
  });
}

export async function POST(req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const ctx = await requireOrg("prescriptions.write");
    /* The patient must be this hospital's before any of it is read or written. */
    assertPatientInOrg(ctx.orgId, id);
    const input = await body<Record<string, unknown>>(req);
    return { ok: true, medication: prescribe(ctx, { ...input, patientId: id }) };
  });
}
