import { handler } from "@/lib/server/route";
import { getSession, toSessionUser, userCan, type DbUser } from "@/lib/server/auth";
import { all, get, settings } from "@/lib/server/db";
import { ALL_FEATURES, DEFAULT_STORAGE, DEFAULT_VOICE, getSubscription, listOrganizations } from "@/lib/server/provision";
import { redactSecrets } from "@/lib/server/secrets";

/**
 * The workspace shell, and nothing else.
 *
 * This endpoint runs before the first pixel of every screen, so its cost is the
 * floor under the whole product's responsiveness. It used to return the tenant's
 * entire dataset — every patient, every lab order, every record kind — which at
 * 8,000 patients meant 3.4 MB and five seconds before anything appeared.
 *
 * It now returns only what the chrome needs to render: who you are, which
 * hospital you are in, what you are allowed to see, and the handful of counts
 * the sidebar badges display. Everything else is fetched by
 * `/api/collections`, which the store requests immediately afterwards without
 * blocking the first paint, and by the paginated per-domain endpoints.
 */
export async function GET() {
  return handler(async () => {
    const session = await getSession();
    if (!session) return { authenticated: false };

    const orgId = session.orgId;
    if (!orgId) return { authenticated: true, user: session.user, org: null };

    const orgRow = get<Record<string, unknown>>("SELECT * FROM organizations WHERE id = ?", [orgId]);
    if (!orgRow) return { authenticated: true, user: session.user, org: null };

    /* Staff directory data includes names, email addresses, phone numbers,
       roles and security posture. Only user administrators need it in the
       workspace bootstrap; everybody else gets an empty list. */
    const users = userCan(session.user, "users.manage")
      ? all<DbUser>("SELECT * FROM users WHERE org_id = ? ORDER BY created_at DESC LIMIT 500", [orgId]).map(toSessionUser)
      : [];

    const mayReadSetting = (key: string) => {
      if (key === "storage") return userCan(session.user, "org.configure");
      if (key === "voice" || key === "knowledge") return userCan(session.user, "agents.configure");
      if (key === "telephony") return userCan(session.user, "telephony.configure");
      if (key === "analytics.series") return userCan(session.user, "analytics.view");
      if (key === "escalation") {
        return userCan(session.user, "protocols.configure") ||
          userCan(session.user, "calls.initiate") ||
          userCan(session.user, "escalations.resolve");
      }
      return false;
    };

    const org = {
      id: orgRow.id, name: orgRow.name, shortName: orgRow.short_name, slug: orgRow.slug, city: orgRow.city,
      state: orgRow.state, timezone: orgRow.timezone, accentColor: orgRow.accent_color,
      logoInitials: orgRow.logo_initials, status: orgRow.status, plan: orgRow.plan,
      deployment: orgRow.deployment, isDemo: Boolean(orgRow.is_demo), createdAt: orgRow.created_at,
    };

    const organizations =
      session.user.role === "super_admin"
        ? listOrganizations().map((o) => ({
            id: o.id, name: o.name, shortName: o.short_name, city: o.city, accentColor: o.accent_color,
            logoInitials: o.logo_initials, status: o.status, plan: o.plan, deployment: o.deployment,
            isDemo: Boolean(o.is_demo), createdAt: o.created_at,
          }))
        : [org];

    /*
     * Sidebar badges. Counted in SQL rather than by shipping the rows and
     * calling `.filter().length` in the browser — the numbers are four integers,
     * not four collections.
     */
    const countKind = (kind: string, test: (v: Record<string, unknown>) => boolean) =>
      all<{ data: string }>("SELECT data FROM records WHERE org_id = ? AND kind = ?", [orgId, kind])
        .reduce((n, r) => {
          try { return n + (test(JSON.parse(r.data)) ? 1 : 0); } catch { return n; }
        }, 0);

    const badges = {
      escalations: countKind("escalation", (e) => e.status === "open"),
      tasks: countKind("task", (t) => t.status === "open"),
      messages: countKind("thread", (t) => Number(t.unread ?? 0) > 0),
      criticalLabs: get<{ c: number }>(
        "SELECT count(*) c FROM lab_orders WHERE org_id = ? AND critical = 1 AND status NOT IN ('RELEASED','CANCELLED')",
        [orgId],
      )?.c ?? 0,
      patients: get<{ c: number }>("SELECT count(*) c FROM patients WHERE org_id = ? AND status = 'active'", [orgId])?.c ?? 0,
      occupiedBeds: get<{ c: number }>("SELECT count(*) c FROM beds WHERE org_id = ? AND status = 'OCCUPIED'", [orgId])?.c ?? 0,
      totalBeds: get<{ c: number }>("SELECT count(*) c FROM beds WHERE org_id = ?", [orgId])?.c ?? 0,
    };

    return {
      authenticated: true,
      user: session.user,
      org,
      organizations,
      subscription: getSubscription(orgId),
      /*
       * Settings travel to the browser with their secrets removed. The blobs
       * carry each hospital's own voice-provider keys and S3 credentials, and
       * this endpoint is reached by every signed-in role including the patient
       * portal — so redaction here is not a nicety, it is the only thing
       * between a receptionist's DevTools and the hospital's API keys.
       */
      settings: Object.fromEntries(
        Object.entries(settings.all(orgId)).filter(([k]) => mayReadSetting(k)).map(([k, v]) => {
          /* Complete the blob before redacting, so a screen reading a field a
             tenant's stored JSON predates gets a default rather than a crash. */
          const base = k === "voice" ? DEFAULT_VOICE : k === "storage" ? DEFAULT_STORAGE : null;
          const merged = base ? { ...base, ...(v as object) } : v;
          return [k, redactSecrets(k, merged)];
        }),
      ),
      featureCatalog: ALL_FEATURES,
      users,
      badges,
    };
  });
}
