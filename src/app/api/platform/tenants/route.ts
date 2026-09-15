import { handler } from "@/lib/server/route";
import { HttpError, requireSession } from "@/lib/server/auth";
import { all, get } from "@/lib/server/db";
import { getSubscription } from "@/lib/server/provision";

export async function GET() {
  return handler(async () => {
    const s = await requireSession();
    if (s.user.role !== "super_admin") throw new HttpError(403, "Platform console is restricted");
    const orgs = all<Record<string, unknown>>("SELECT * FROM organizations ORDER BY created_at DESC");
    return {
      tenants: orgs.map((o) => {
        const orgId = String(o.id);
        const users = get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE org_id = ?", [orgId])?.n ?? 0;
        const patients = get<{ n: number }>("SELECT COUNT(*) AS n FROM records WHERE org_id = ? AND kind = 'patient'", [orgId])?.n ?? 0;
        const calls = get<{ n: number }>("SELECT COUNT(*) AS n FROM records WHERE org_id = ? AND kind = 'call'", [orgId])?.n ?? 0;
        const onboarding = get<{ completed: number; step: number }>("SELECT completed, step FROM onboarding WHERE org_id = ?", [orgId]);
        return {
          id: orgId, name: o.name, shortName: o.short_name, city: o.city, status: o.status, plan: o.plan,
          deployment: o.deployment, accentColor: o.accent_color, logoInitials: o.logo_initials,
          isDemo: Boolean(o.is_demo), createdAt: o.created_at,
          users, patients, calls,
          onboardingComplete: Boolean(onboarding?.completed),
          subscription: getSubscription(orgId),
        };
      }),
    };
  });
}
