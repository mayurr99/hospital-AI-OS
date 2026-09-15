import { body, handler } from "@/lib/server/route";
import { requireOrg } from "@/lib/server/auth";
import { createEncounter, listEncounters } from "@/lib/server/clinicaldata";

export async function GET(req: Request) {
  return handler(async () => {
    const { orgId, session } = await requireOrg("patients.clinical.view");
    const u = new URL(req.url);
    return {
      items: listEncounters(orgId, {
        patientId: u.searchParams.get("patientId") ?? undefined,
        status: u.searchParams.get("status") ?? undefined,
        providerId: u.searchParams.get("mine") === "1" ? session.user.providerId ?? undefined : undefined,
      }),
    };
  });
}

export async function POST(req: Request) {
  return handler(async () => {
    const ctx = await requireOrg("encounters.write");
    return { ok: true, encounter: createEncounter(ctx, await body<Record<string, unknown>>(req)) };
  });
}
