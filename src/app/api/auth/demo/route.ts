import { NextResponse } from "next/server";
import { handler } from "@/lib/server/route";
import { all, get, writeAudit } from "@/lib/server/db";
import { HttpError, type DbUser } from "@/lib/server/auth";
import { completeSignIn } from "@/lib/server/signin";
import { callerIp, hit, LOGIN_PER_IP } from "@/lib/server/ratelimit";

/**
 * GET /api/auth/demo — what the sign-in screen needs to know about this
 * deployment, drawn from the database rather than from a setting that can drift
 * out of step with it.
 *
 * **Demo tenants.** The screen offers one-click entry to the demo hospital and
 * prints its shared password. That is right for a build someone is evaluating
 * and indefensible on a server holding real patients, so the screen asks rather
 * than assumes.
 *
 * **Any tenants at all.** A production build started against an empty data
 * directory seeds nothing, by design — and the screen then answered every
 * attempt with "that email and password do not match an account", which is true
 * and completely unhelpful. It now says the server has no hospitals yet.
 *
 * **The way in.** The entry account is looked up here, not hard-coded in the
 * page. A button on the front door that points at an account which no longer
 * exists is exactly the kind of control that does nothing, and this is the only
 * place that can know for certain which account is real.
 *
 * No password is returned, and none is needed: POST to this same route signs
 * the visitor in server-side (see below).
 */

/** Aggregate counts only, and only ever for a tenant marked as demo. */
function contents(orgId: string) {
  const n = (sql: string) => get<{ c: number }>(sql, [orgId])?.c ?? 0;
  return {
    patients: n("SELECT COUNT(*) AS c FROM patients WHERE org_id = ?"),
    wards: n("SELECT COUNT(*) AS c FROM wards WHERE org_id = ?"),
    beds: n("SELECT COUNT(*) AS c FROM beds WHERE org_id = ?"),
    labOrders: n("SELECT COUNT(*) AS c FROM lab_orders WHERE org_id = ?"),
    staff: n("SELECT COUNT(*) AS c FROM users WHERE org_id = ? AND status = 'active'"),
  };
}

/**
 * The demo tenant the front door opens, and the account it opens it as.
 *
 * Both the description and the sign-in go through this one function, because
 * they disagreed when they did not: the card described the fullest demo
 * hospital while the sign-in took the oldest, so the button advertised
 * DemoCare and opened something else — or, as it happened, an older tenant
 * with no administrator, and failed outright. Two rules for picking the same
 * thing is one rule too many.
 *
 * Picked by content: a visitor should land in the hospital with records in it,
 * and as the administrator, who can see every module. A role seeing a third of
 * the product would be a poor first look.
 */
function primaryDemo() {
  const demoOrgs = all<{ id: string; name: string; short_name: string; city: string }>(
    "SELECT id, name, short_name, city FROM organizations WHERE is_demo = 1",
  );
  if (!demoOrgs.length) return null;

  const ranked = demoOrgs
    .map((o) => ({ org: o, counts: contents(o.id) }))
    .sort((a, b) => b.counts.patients - a.counts.patients);

  /* The fullest tenant that actually has someone to sign in as. */
  for (const candidate of ranked) {
    const admin = get<{ id: string; email: string; name: string }>(
      "SELECT id, email, name FROM users WHERE org_id = ? AND role = 'hospital_admin' AND status = 'active' ORDER BY created_at LIMIT 1",
      [candidate.org.id],
    );
    if (admin) return { ...candidate, admin };
  }
  return null;
}

export async function GET() {
  return handler(async () => {
    const anyOrg = get<{ n: number }>("SELECT COUNT(*) AS n FROM organizations")?.n ?? 0;
    const hasDemo = (get<{ n: number }>("SELECT COUNT(*) AS n FROM organizations WHERE is_demo = 1")?.n ?? 0) > 0;
    const primary = primaryDemo();

    if (!primary) {
      return { demoAvailable: hasDemo, noHospitalsYet: anyOrg === 0, entry: null };
    }
    const admin = primary.admin;

    return {
      demoAvailable: true,
      noHospitalsYet: false,
      entry: admin
        ? {
            personName: admin.name,
            hospitalName: primary.org.name,
            shortName: primary.org.short_name,
            city: primary.org.city,
            counts: primary.counts,
          }
        : null,
    };
  });
}


/**
 * POST /api/auth/demo — open the demo hospital, without a credential ever
 * reaching the browser.
 *
 * The sign-in screen used to hold the demo password as a constant and post it
 * to the normal login route. That printed it on screen, and — less obviously,
 * and worse — shipped it inside the JavaScript bundle, where removing it from
 * the screen would not have removed it at all. Anyone reading the bundle of a
 * deployment that had once had demo tenants would find a working password.
 *
 * So the decision is made here instead. The browser asks to look around; the
 * server decides whether there is anything to look around in, and signs the
 * visitor into it. There is no password in the page, in the bundle, or on the
 * wire.
 *
 * The guard that matters is the last one: this will only ever open a tenant
 * marked `is_demo`. It is not a way to sign in as an arbitrary administrator,
 * and it cannot become one by passing something different — it takes no
 * parameters at all.
 */
export async function POST(req: Request) {
  return handler(async () => {
    const ip = callerIp(req);
    /* Unmetered, this is a free session factory. Same budget as a sign-in. */
    const gate = hit(`demo:ip:${ip}`, LOGIN_PER_IP);
    if (!gate.allowed) {
      return NextResponse.json(
        { error: "Too many demo sessions from this connection. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
      );
    }

    /* The same pick the card described — see primaryDemo. */
    const primary = primaryDemo();
    if (!primary) throw new HttpError(404, "This server has no demo hospital to open.");

    const user = get<DbUser>("SELECT * FROM users WHERE id = ?", [primary.admin.id]);
    if (!user) throw new HttpError(404, "The demo hospital has no administrator to sign in as.");
    const org = primary.org;

    /*
     * Belt and braces. The query above already filters on is_demo, but this is
     * the assertion that would stop a future edit — a widened query, a new
     * parameter — from turning this into an unauthenticated way into a real
     * hospital. It is cheap and it is the whole safety of the endpoint.
     */
    const confirmed = get<{ is_demo: number }>("SELECT is_demo FROM organizations WHERE id = ?", [user.org_id ?? ""]);
    if (!confirmed?.is_demo) throw new HttpError(403, "That is not a demo hospital.");

    writeAudit({
      orgId: user.org_id,
      actor: user.name,
      actorRole: user.role,
      /* Distinguishable in the trail from a real sign-in by that person. */
      action: "login.demo_visitor",
      target: `${org.name} — opened from the sign-in screen`,
      severity: "info",
      ip,
    });

    return completeSignIn(user, ip, "demo_visitor", { demo: true });
  });
}
