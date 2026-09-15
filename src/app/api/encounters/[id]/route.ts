import { body, handler } from "@/lib/server/route";
import { requireOrg } from "@/lib/server/auth";
import {
  closeEncounter, getEncounter, listEncounterVersions, markEncounterInError, updateEncounter,
} from "@/lib/server/clinicaldata";

export async function GET(_req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const { orgId } = await requireOrg("patients.clinical.view");
    return { encounter: getEncounter(orgId, id), versions: listEncounterVersions(orgId, id) };
  });
}

/**
 * PATCH amends the note and snapshots the previous version.
 * `action` performs a state change rather than a field edit.
 */
export async function PATCH(req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const ctx = await requireOrg("encounters.write");
    const input = await body<Record<string, unknown>>(req);
    const action = String(input.action ?? "");

    if (action === "close") return { ok: true, encounter: closeEncounter(ctx, id) };
    if (action === "entered_in_error") {
      return { ok: true, encounter: markEncounterInError(ctx, id, String(input.reason ?? "")) };
    }
    return { ok: true, encounter: updateEncounter(ctx, id, input, String(input.reason ?? "")) };
  });
}
