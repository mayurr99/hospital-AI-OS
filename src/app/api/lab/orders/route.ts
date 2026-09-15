import { body, handler } from "@/lib/server/route";
import { requireOrg } from "@/lib/server/auth";
import { createLabOrder, listLabOrders } from "@/lib/server/labs";

export async function GET(req: Request) {
  return handler(async () => {
    const { orgId } = await requireOrg("labs.manage");
    const u = new URL(req.url);
    return {
      items: listLabOrders(orgId, {
        status: u.searchParams.get("status") ?? undefined,
        patientId: u.searchParams.get("patientId") ?? undefined,
      }),
    };
  });
}

export async function POST(req: Request) {
  return handler(async () => {
    const ctx = await requireOrg("labs.order");
    const input = await body<Record<string, unknown>>(req);
    return {
      ok: true,
      order: createLabOrder(ctx, {
        patientId: String(input.patientId ?? ""),
        testIds: (input.testIds as string[]) ?? [],
        testCodes: (input.testCodes as string[]) ?? [],
        priority: input.priority as string,
        clinicalNote: input.clinicalNote as string,
        encounterId: (input.encounterId as string) ?? null,
        admissionId: (input.admissionId as string) ?? null,
      }),
    };
  });
}
