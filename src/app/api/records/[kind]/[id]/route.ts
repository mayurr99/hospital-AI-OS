import { body, handler } from "@/lib/server/route";
import { HttpError, audit, requireOrg } from "@/lib/server/auth";
import { records } from "@/lib/server/db";
import { RECORD_KINDS, type RecordKind } from "@/lib/server/provision";
import { WRITE_PERMISSION, describe } from "@/lib/server/kinds";

/**
 * Patients, wards, beds and lab orders were migrated out of this generic blob
 * store into real tables with constraints, status machines and audit. Writing
 * them through an untyped, unvalidated CRUD endpoint would bypass all of that,
 * so those kinds are refused here and routed to their own APIs.
 */
const RELATIONAL_KINDS: Record<string, string> = {
  patient: "/api/patients",
  ward: "/api/wards",
  bed: "/api/beds",
  labOrder: "/api/lab/orders",
};

function assertKind(kind: string, write = false): RecordKind {
  if (!(RECORD_KINDS as readonly string[]).includes(kind)) throw new HttpError(404, `Unknown record type: ${kind}`);
  if (write && RELATIONAL_KINDS[kind]) {
    throw new HttpError(
      409,
      `${kind} is no longer a generic record. Use ${RELATIONAL_KINDS[kind]} so validation, status rules and the clinical audit trail are applied.`,
    );
  }
  return kind as RecordKind;
}

export async function GET(_req: Request, ctx: { params: Promise<{ kind: string; id: string }> }) {
  return handler(async () => {
    const p = await ctx.params;
    const kind = assertKind(p.kind);
    const { orgId } = await requireOrg();
    const record = records.get(orgId, kind, p.id);
    if (!record) throw new HttpError(404, "Not found");
    return { record };
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ kind: string; id: string }> }) {
  return handler(async () => {
    const p = await ctx.params;
    const kind = assertKind(p.kind, true);
    const { session, orgId } = await requireOrg(WRITE_PERMISSION[kind]);
    const patch = await body<Record<string, unknown>>(req);
    delete patch.id;
    delete patch.orgId;
    const record = records.patch(orgId, kind, p.id, patch);
    if (!record) throw new HttpError(404, "Not found in this hospital");
    audit(session, `${kind}.updated`, describe(kind, record as Record<string, unknown>));
    return { ok: true, record };
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ kind: string; id: string }> }) {
  return handler(async () => {
    const p = await ctx.params;
    const kind = assertKind(p.kind, true);
    const { session, orgId } = await requireOrg(WRITE_PERMISSION[kind]);
    const existing = records.get(orgId, kind, p.id);
    if (!existing) throw new HttpError(404, "Not found in this hospital");
    records.remove(orgId, kind, p.id);
    audit(session, `${kind}.deleted`, describe(kind, existing as Record<string, unknown>), "warning");
    return { ok: true };
  });
}
