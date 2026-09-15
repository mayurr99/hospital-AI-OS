import { handler } from "@/lib/server/route";
import { getSession } from "@/lib/server/auth";
import { get } from "@/lib/server/db";
import { getSubscription } from "@/lib/server/provision";

export async function GET() {
  return handler(async () => {
    const s = await getSession();
    if (!s) return { user: null };
    const onboarding = s.orgId
      ? get<{ completed: number; step: number }>("SELECT completed, step FROM onboarding WHERE org_id = ?", [s.orgId])
      : null;
    return {
      user: s.user,
      orgId: s.orgId,
      subscription: s.orgId ? getSubscription(s.orgId) : null,
      onboardingComplete: onboarding ? Boolean(onboarding.completed) : true,
    };
  });
}
