import { body, handler } from "@/lib/server/route";
import { audit, requireOrg } from "@/lib/server/auth";
import { createPatient, searchPatients, findDuplicates } from "@/lib/server/patients";
import { validatePatient } from "@/lib/server/validate";

/** GET /api/patients — tenant-scoped search. The org never comes from the query string. */
export async function GET(req: Request) {
  return handler(async () => {
    const { orgId, session } = await requireOrg("patients.view");
    const u = new URL(req.url);
    // A doctor sees their own panel unless they ask for the whole directory.
    const mine = u.searchParams.get("mine") === "1" && session.user.role === "doctor";
    return searchPatients(orgId, {
      q: u.searchParams.get("q") ?? undefined,
      status: u.searchParams.get("status") ?? undefined,
      departmentId: u.searchParams.get("departmentId") ?? undefined,
      risk: u.searchParams.get("risk") ?? undefined,
      providerId: mine ? session.user.providerId ?? undefined : undefined,
      admitted: u.searchParams.get("admitted") === "1",
      limit: Number(u.searchParams.get("limit") ?? 100),
      offset: Number(u.searchParams.get("offset") ?? 0),
    });
  });
}

/** POST /api/patients — register a patient. */
export async function POST(req: Request) {
  return handler(async () => {
    const ctx = await requireOrg("patients.register");
    const input = await body<Record<string, unknown>>(req);
    const { check, value } = validatePatient(input);
    check.throwIfAny();

    const matches = findDuplicates(ctx.orgId, value);
    const strong = matches.find((m) => m.strength === "strong");
    if (strong && !input.forceCreate) {
      return { duplicate: true, matches, message: `A patient already exists: ${strong.name} (${strong.uhid}) — ${strong.reason}` };
    }
    /*
     * `forceCreate` means an operator has seen the suggested match and said
     * these are different people. That decision belongs to them, so the guard
     * inside createPatient stands down — but only because a human answered it.
     */
    /*
     * The matches reported back are the ones found inside the write lock, not
     * the ones from the check above. Two desks registering the same walk-in in
     * the same second each saw an empty list from the pre-check — because
     * neither had committed yet — and the hospital got two unflagged charts for
     * one person. Inside the transaction the second one sees the first.
     */
    let lockedMatches = matches;
    const patient = createPatient(ctx, value, {
      source: "manual",
      skipDuplicateCheck: Boolean(input.forceCreate),
      onDuplicates: (m) => { lockedMatches = m; },
    });
    audit(ctx.session, "patient.created", `Patient ${patient.fullName} (${patient.uhid})`);
    return { ok: true, patient, possibleMatches: lockedMatches };
  });
}
