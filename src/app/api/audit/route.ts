import { handler } from "@/lib/server/route";
import { requireOrg } from "@/lib/server/auth";
import { all } from "@/lib/server/db";

export async function GET(req: Request) {
  return handler(async () => {
    const { orgId } = await requireOrg("audit.view");
    const limit = Math.min(500, Number(new URL(req.url).searchParams.get("limit") ?? 200));
    const rows = all<Record<string, unknown>>(
      "SELECT * FROM audit_logs WHERE org_id = ? ORDER BY at DESC LIMIT ?", [orgId, limit],
    );
    return {
      logs: rows.map((l) => ({
        id: l.id, orgId: l.org_id, actor: l.actor, actorRole: l.actor_role, action: l.action,
        target: l.target, severity: l.severity, ip: l.ip, at: l.at,
      })),
    };
  });
}
