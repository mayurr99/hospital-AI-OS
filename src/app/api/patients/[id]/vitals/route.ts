import { body, handler } from "@/lib/server/route";
import { requireOrg } from "@/lib/server/auth";
import { assertPatientInOrg } from "@/lib/server/patients";
import { listVitals, recordVitals } from "@/lib/server/clinicaldata";

export async function GET(_req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const { orgId } = await requireOrg("patients.clinical.view");
    /* The patient must be this hospital's before any of it is read or written. */
    assertPatientInOrg(orgId, id);
    return { items: listVitals(orgId, id, 200) };
  });
}

export async function POST(req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const ctx = await requireOrg("vitals.record");
    /* The patient must be this hospital's before any of it is read or written. */
    assertPatientInOrg(ctx.orgId, id);
    const input = await body<Record<string, unknown>>(req);
    return { ok: true, vitals: recordVitals(ctx, { ...input, patientId: id }) };
  });
}
