import { handler } from "@/lib/server/route";
import { requireOrg, userCan } from "@/lib/server/auth";
import { all, records } from "@/lib/server/db";
import { RECORD_KINDS } from "@/lib/server/provision";
import { READ_PERMISSION } from "@/lib/server/kinds";
import { legacyPatientShape } from "@/lib/server/patients";
import { legacyBedShape, legacyWardShape } from "@/lib/server/admissions";
import { legacyLabShape } from "@/lib/server/labs";

/**
 * The tenant's working set.
 *
 * Split out of `/api/bootstrap` so the workspace chrome paints before this
 * lands. Every collection here is bounded, and — as importantly — every one is
 * filtered by the caller's own permissions.
 *
 * That second point was got wrong once and is worth stating plainly: when this
 * endpoint was created it checked only that the caller had a session in some
 * hospital. Being inside a tenant is not authorisation. A patient-portal
 * account, whose sole permission is to see its own record, could read three
 * hundred other patients, sixty call transcripts and the audit trail, because
 * it asked for the lists rather than for a record. A bulk endpoint has to
 * enforce exactly what the per-record endpoints enforce, or it becomes the way
 * around them.
 *
 * The bounds are a working set, not a limit on the data — each domain has a
 * paginated endpoint (`/api/patients`, `/api/lab/orders`, `/api/admissions`)
 * that screens use to search and page beyond what is cached here.
 */
const RELATIONAL_KINDS = new Set(["patient", "ward", "bed", "labOrder"]);

/** How many rows of each JSON-backed kind the workspace keeps in memory. */
const KIND_CAP: Record<string, number> = {
  call: 300,
  appointment: 500,
  invoice: 300,
  thread: 200,
  emergencyCase: 200,
  importJob: 100,
};
const DEFAULT_CAP = 1000;

export async function GET(req: Request) {
  return handler(async () => {
    /* A session alone is not enough: the caller must at least be staff who may
       look at patients before any clinical list is assembled for them. */
    const { session, orgId } = await requireOrg("patients.view");
    const may = (p: Parameters<typeof userCan>[1]) => userCan(session.user, p);

    const url = new URL(req.url);
    const only = url.searchParams.get("kinds")?.split(",").map((s) => s.trim()).filter(Boolean);
    const wanted = (kind: string) => !only?.length || only.includes(kind);

    const data: Record<string, unknown[]> = {};
    for (const kind of RECORD_KINDS) {
      if (RELATIONAL_KINDS.has(kind) || !wanted(kind)) continue;
      const needed = READ_PERMISSION[kind];
      /* A kind this role may not read is simply absent — not empty, not hidden
         in the client. It never leaves the server. */
      if (needed && !may(needed)) continue;
      const cap = KIND_CAP[kind] ?? DEFAULT_CAP;
      const rows = records.list(orgId, kind);
      data[kind] = rows.length > cap ? rows.slice(0, cap) : rows;
    }

    /*
     * Calls carry full transcripts of conversations with patients. Anyone who
     * may see that a call happened does not thereby get to read what was said.
     */
    if (data.call && !may("calls.listen")) {
      data.call = (data.call as Record<string, unknown>[]).map((c) => ({ ...c, transcript: [], summary: "" }));
    }

    if (wanted("patient")) {
      const full = may("patients.clinical.view");
      const rows = legacyPatientShape(orgId, { limit: 300 });
      /* Reception can run the front desk without reading anyone's diagnosis. */
      data.patient = full
        ? rows
        : rows.map((p) => ({ ...p, diagnosis: "", carePathway: "", allergies: [], medications: [] }));
    }
    if (wanted("ward") && may("ipd.manage")) data.ward = legacyWardShape(orgId);
    if (wanted("bed") && may("ipd.manage")) data.bed = legacyBedShape(orgId);
    if (wanted("labOrder") && may("labs.manage")) data.labOrder = legacyLabShape(orgId);

    /*
     * Administrative tails, each behind the permission that governs the screen
     * that reads it. The export list is deliberately stripped of its download
     * tokens: a token is a bearer credential for a full-PHI file, and it has no
     * business travelling with a list.
     */
    const auditLogs = wanted("auditLogs") && may("audit.view")
      ? all<Record<string, unknown>>(
          "SELECT * FROM audit_logs WHERE org_id = ? ORDER BY at DESC LIMIT 200", [orgId],
        ).map((l) => ({
          id: l.id, orgId: l.org_id, actor: l.actor, actorRole: l.actor_role, action: l.action,
          target: l.target, severity: l.severity, ip: l.ip, at: l.at,
        }))
      : undefined;

    const recordings = wanted("recordings") && may("calls.listen")
      ? all<Record<string, unknown>>(
          "SELECT * FROM recordings WHERE org_id = ? ORDER BY created_at DESC LIMIT 200", [orgId],
        ).map((r) => ({
          id: r.id, orgId: r.org_id, callId: r.call_id, patientId: r.patient_id, storageKind: r.storage_kind,
          storageKey: r.storage_key, bytes: r.bytes, durationSeconds: r.duration_secs, mime: r.mime,
          consent: Boolean(r.consent), retentionUntil: r.retention_until, createdAt: r.created_at,
        }))
      : undefined;

    const exports_ = wanted("exports") && may("data.export")
      ? all<Record<string, unknown>>(
          "SELECT * FROM export_jobs WHERE org_id = ? ORDER BY created_at DESC LIMIT 100", [orgId],
        ).map((e) => ({
          id: e.id, orgId: e.org_id, requestedBy: e.requested_by, template: e.template,
          scope: JSON.parse(String(e.scope || "{}")), status: e.status, rows: e.rows, bytes: e.bytes,
          expiresAt: e.expires_at, downloadedAt: e.downloaded_at,
          createdAt: e.created_at, completedAt: e.completed_at,
        }))
      : undefined;

    return {
      authenticated: true,
      ...data,
      ...(auditLogs ? { auditLogs } : {}),
      ...(recordings ? { recordings } : {}),
      ...(exports_ ? { exports: exports_ } : {}),
    };
  });
}
