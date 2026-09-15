import { body, handler } from "@/lib/server/route";
import { HttpError, audit, requireSession, switchSessionOrg } from "@/lib/server/auth";
import { get } from "@/lib/server/db";

export async function POST(req: Request) {
  return handler(async () => {
    const s = await requireSession();
    const { orgId, justification } = await body<{ orgId: string; justification?: string }>(req);
    if (s.user.role !== "super_admin") throw new HttpError(403, "Only platform staff can switch hospital workspace");
    const org = get<{ name: string }>("SELECT name FROM organizations WHERE id = ?", [orgId]);
    if (!org) throw new HttpError(404, "Unknown hospital");
    await switchSessionOrg(s.token, orgId);
    audit({ ...s, orgId }, "tenant.access", `${org.name} — justification: ${justification ?? "not given"}`, "critical");
    return { ok: true, orgId };
  });
}
