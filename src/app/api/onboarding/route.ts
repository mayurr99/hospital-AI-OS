import { body, handler } from "@/lib/server/route";
import { HttpError, audit, requireOrg } from "@/lib/server/auth";
import { get, nowIso, run } from "@/lib/server/db";
import { provisionTenant, type OnboardingAnswers } from "@/lib/server/provision";
import { backfillOrg } from "@/lib/server/backfill";

export async function GET() {
  return handler(async () => {
    const { orgId } = await requireOrg();
    const row = get<{ step: number; completed: number; answers: string }>(
      "SELECT step, completed, answers FROM onboarding WHERE org_id = ?", [orgId],
    );
    return {
      step: row?.step ?? 0,
      completed: Boolean(row?.completed),
      answers: JSON.parse(row?.answers ?? "{}") as OnboardingAnswers,
    };
  });
}

/** Saves progress between steps so a half-finished setup survives a refresh. */
export async function PATCH(req: Request) {
  return handler(async () => {
    const { session, orgId } = await requireOrg("org.configure");
    const b = await body<{ step: number; answers: OnboardingAnswers }>(req);
    const existing = get<{ answers: string }>("SELECT answers FROM onboarding WHERE org_id = ?", [orgId]);
    const merged = { ...(JSON.parse(existing?.answers ?? "{}") as OnboardingAnswers), ...b.answers };
    run("UPDATE onboarding SET step = ?, answers = ?, updated_at = ? WHERE org_id = ?", [
      b.step ?? 0, JSON.stringify(merged), nowIso(), orgId,
    ]);
    void session;
    return { ok: true, step: b.step, answers: merged };
  });
}

/** Completes setup: provisions departments, doctors, agents, protocol and settings. */
export async function POST(req: Request) {
  return handler(async () => {
    const { session, orgId } = await requireOrg("org.configure");
    const b = await body<{ answers: OnboardingAnswers }>(req);
    if (!b.answers?.departments?.length) throw new HttpError(400, "Select at least one department");
    const result = provisionTenant(orgId, b.answers);
    // Provisioning still writes wards, beds and sample rows through the legacy
    // record store; reshape them into the relational clinical core immediately
    // so a brand-new hospital has real beds, admissions and a lab catalogue.
    backfillOrg(orgId);
    audit(session, "onboarding.completed",
      `${result.departments.length} departments, ${result.providers.length} doctors, ${(b.answers.features ?? []).length} features unlocked`,
      "critical");
    return { ok: true, ...result };
  });
}
