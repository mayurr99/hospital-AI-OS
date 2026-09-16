import { body, handler } from "@/lib/server/route";
import { HttpError, audit, requireSession, switchSessionOrg } from "@/lib/server/auth";
import { get } from "@/lib/server/db";

export async function POST(req: Request) {
  return handler(async () => {
    const s = await requireSession();
    const { orgId, justification } = await body<{ orgId: string; justification?: string }>(req);
    if (s.user.role !== "super_admin") throw new HttpError(403, "Only platform staff can switch hospital workspace");
    const org = get<{ name: string; status: string }>("SELECT name, status FROM organizations WHERE id = ?", [orgId]);
    if (!org) throw new HttpError(404, "Unknown hospital");
    const subscription = get<{ status: string }>("SELECT status FROM subscriptions WHERE org_id = ?", [orgId]);
    if (org.status === "suspended" || subscription?.status === "suspended" || subscription?.status === "cancelled") {
      throw new HttpError(403, "This hospital workspace is not active");
    }
    await switchSessionOrg(s.token, orgId);
    audit({ ...s, orgId }, "tenant.access", `${org.name} — justification: ${justification ?? "not given"}`, "critical");
    return { ok: true, orgId };
  });
}
