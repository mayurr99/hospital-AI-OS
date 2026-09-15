import { body, handler } from "@/lib/server/route";
import { requireOrg } from "@/lib/server/auth";
import { assertPatientInOrg } from "@/lib/server/patients";
import { addDiagnosis, listDiagnoses, setDiagnosisStatus } from "@/lib/server/clinicaldata";

export async function GET(_req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const { orgId } = await requireOrg("patients.clinical.view");
    /* The patient must be this hospital's before any of it is read or written. */
    assertPatientInOrg(orgId, id);
    return { items: listDiagnoses(orgId, id, true) };
  });
}

export async function POST(req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const ctx = await requireOrg("encounters.write");
    /* The patient must be this hospital's before any of it is read or written. */
    assertPatientInOrg(ctx.orgId, id);
    const input = await body<Record<string, unknown>>(req);
    return { ok: true, diagnosis: addDiagnosis(ctx, { ...input, patientId: id }) };
  });
}

export async function PATCH(req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const ctx = await requireOrg("encounters.write");
    /* The patient must be this hospital's before any of it is read or written. */
    assertPatientInOrg(ctx.orgId, id);
    const input = await body<{ diagnosisId: string; status: "resolved" | "entered_in_error"; reason?: string }>(req);
    setDiagnosisStatus(ctx, input.diagnosisId, input.status, input.reason ?? "");
    return { ok: true, items: listDiagnoses(ctx.orgId, id, true) };
  });
}
