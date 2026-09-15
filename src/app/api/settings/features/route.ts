import { body, handler } from "@/lib/server/route";
import { HttpError, audit, requireOrg } from "@/lib/server/auth";
import { nowIso, run } from "@/lib/server/db";
import { ALL_FEATURES } from "@/lib/server/provision";

export async function PUT(req: Request) {
  return handler(async () => {
    const { session, orgId } = await requireOrg("org.configure");
    const { features } = await body<{ features: string[] }>(req);
    if (!Array.isArray(features)) throw new HttpError(400, "features must be an array");
    const valid = new Set<string>(ALL_FEATURES.map((f) => f.key));
    const cleaned = features.filter((f) => valid.has(f));
    run("UPDATE subscriptions SET features = ?, updated_at = ? WHERE org_id = ?", [
      JSON.stringify(cleaned), nowIso(), orgId,
    ]);
    audit(session, "plan.modules.updated", `${cleaned.length} modules unlocked`, "warning");
    return { ok: true, features: cleaned };
  });
}
