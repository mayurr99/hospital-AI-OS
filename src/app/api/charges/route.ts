import { handler } from "@/lib/server/route";
import { requireOrg } from "@/lib/server/auth";
import { listCharges } from "@/lib/server/charges";

/**
 * GET /api/charges — what clinical activity has cost, per patient or admission.
 *
 * Every line here was raised by a clinical event and carries the id of the
 * record that caused it, so a bill can be traced to the work that justifies it
 * rather than to somebody's data entry.
 */
export async function GET(req: Request) {
  return handler(async () => {
    const { orgId } = await requireOrg("billing.manage");
    const u = new URL(req.url);
    const items = listCharges(orgId, {
      patientId: u.searchParams.get("patientId") ?? undefined,
      admissionId: u.searchParams.get("admissionId") ?? undefined,
      status: u.searchParams.get("status") ?? undefined,
      limit: Number(u.searchParams.get("limit") ?? 300),
    });
    return {
      items,
      total: items.filter((c) => c.status !== "CANCELLED").reduce((s, c) => s + c.amount, 0),
    };
  });
}
