import { body, handler } from "@/lib/server/route";
import { requireOrg } from "@/lib/server/auth";
import { createWard, listWards } from "@/lib/server/admissions";

export async function GET() {
  return handler(async () => {
    const { orgId } = await requireOrg("patients.view");
    return { items: listWards(orgId) };
  });
}

/**
 * Create a ward.
 *
 * `org.configure`, not `admissions.manage`: opening a ward is an estate
 * decision taken once by whoever runs the hospital, not something the person
 * admitting a patient at 2am should be able to do by accident.
 */
export async function POST(req: Request) {
  return handler(async () => {
    const ctx = await requireOrg("org.configure");
    const input = await body<Record<string, unknown>>(req);
    return {
      ok: true,
      ward: createWard(ctx, {
        name: String(input.name ?? ""),
        type: input.type as string | undefined,
        floor: input.floor as number | undefined,
        facilityId: (input.facilityId as string) ?? null,
        buildingId: (input.buildingId as string) ?? null,
        genderPolicy: input.genderPolicy as "any" | "male" | "female" | undefined,
      }),
    };
  });
}
