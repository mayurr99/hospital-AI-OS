import { body, handler } from "@/lib/server/route";
import { requireOrg } from "@/lib/server/auth";
import { createAdmission, listAdmissions } from "@/lib/server/admissions";

export async function GET(req: Request) {
  return handler(async () => {
    const { orgId } = await requireOrg("patients.view");
    const u = new URL(req.url);
    return {
      items: listAdmissions(orgId, {
        status: u.searchParams.get("status") ?? "ACTIVE",
        patientId: u.searchParams.get("patientId") ?? undefined,
      }),
    };
  });
}

export async function POST(req: Request) {
  return handler(async () => {
    const ctx = await requireOrg("admissions.manage");
    const input = await body<Record<string, unknown>>(req);
    return {
      ok: true,
      admission: createAdmission(ctx, {
        patientId: String(input.patientId ?? ""),
        type: input.type as string,
        departmentId: (input.departmentId as string) ?? null,
        providerId: (input.providerId as string) ?? null,
        facilityId: (input.facilityId as string) ?? null,
        admittedAt: input.admittedAt as string,
        reason: input.reason as string,
        referredBy: input.referredBy as string,
        bedId: (input.bedId as string) ?? null,
      }),
    };
  });
}
