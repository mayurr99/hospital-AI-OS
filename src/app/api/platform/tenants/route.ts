import { body, handler } from "@/lib/server/route";
import { audit, HttpError, requireSession } from "@/lib/server/auth";
import { all, get, nowIso, run, settings } from "@/lib/server/db";
import { ALL_FEATURES, DEFAULT_STORAGE, DEFAULT_VOICE, getSubscription } from "@/lib/server/provision";
import { SUBSCRIPTION_PLAN_KEYS } from "@/lib/plans";

export async function GET() {
  return handler(async () => {
    const s = await requireSession();
    if (s.user.role !== "super_admin") throw new HttpError(403, "Platform console is restricted");
    const orgs = all<Record<string, unknown>>("SELECT * FROM organizations ORDER BY created_at DESC");
    return {
      availableFeatures: ALL_FEATURES,
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
          services: {
            voice: settings.get(orgId, "voice", DEFAULT_VOICE).telephonyProvider,
            storage: settings.get(orgId, "storage", DEFAULT_STORAGE).driver,
          },
        };
      }),
    };
  });
}

const PLANS = new Set<string>(SUBSCRIPTION_PLAN_KEYS);
const SUB_STATUSES = new Set(["trialing", "active", "past_due", "suspended", "cancelled"]);
const ORG_STATUSES = new Set(["trial", "active", "suspended"]);

export async function PATCH(req: Request) {
  return handler(async () => {
    const session = await requireSession();
    if (session.user.role !== "super_admin") throw new HttpError(403, "Platform console is restricted");
    const b = await body<{
      orgId: string; plan: string; subscriptionStatus: string; orgStatus: string;
      seats: number; voiceMinutesCap: number; monthlyFee: number; features: string[];
    }>(req);
    if (!get("SELECT id FROM organizations WHERE id = ?", [b.orgId])) throw new HttpError(404, "Hospital not found");
    if (!PLANS.has(b.plan)) throw new HttpError(400, "Unknown plan");
    if (!SUB_STATUSES.has(b.subscriptionStatus)) throw new HttpError(400, "Unknown subscription status");
    if (!ORG_STATUSES.has(b.orgStatus)) throw new HttpError(400, "Unknown hospital status");
    const seats = Math.max(1, Math.min(100_000, Math.round(Number(b.seats))));
    const cap = Math.max(0, Math.min(10_000_000, Math.round(Number(b.voiceMinutesCap))));
    const fee = Math.max(0, Math.min(100_000_000, Math.round(Number(b.monthlyFee))));
    if (![seats, cap, fee].every(Number.isFinite)) throw new HttpError(400, "Subscription numbers are invalid");
    const allowed = new Set<string>(ALL_FEATURES.map((f) => f.key));
    const features = Array.isArray(b.features) ? [...new Set(b.features.filter((f) => allowed.has(f)))] : [];

    run("UPDATE organizations SET plan = ?, status = ? WHERE id = ?", [b.plan, b.orgStatus, b.orgId]);
    run(
      `UPDATE subscriptions SET plan = ?, status = ?, seats = ?, voice_minutes_cap = ?,
       monthly_fee = ?, features = ?, updated_at = ? WHERE org_id = ?`,
      [b.plan, b.subscriptionStatus, seats, cap, fee, JSON.stringify(features), nowIso(), b.orgId],
    );
    if (b.orgStatus === "suspended" || b.subscriptionStatus === "suspended" || b.subscriptionStatus === "cancelled") {
      run("DELETE FROM sessions WHERE org_id = ?", [b.orgId]);
    }
    audit(session, "platform.subscription.updated", `${b.orgId}: ${b.plan}/${b.subscriptionStatus}, ${seats} seats`, "critical");
    return { ok: true };
  });
}
