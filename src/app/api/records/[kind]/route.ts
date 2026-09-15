import { body, handler } from "@/lib/server/route";
import { HttpError, audit, requireOrg } from "@/lib/server/auth";
import { id, records } from "@/lib/server/db";
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

export async function GET(_req: Request, ctx: { params: Promise<{ kind: string }> }) {
  return handler(async () => {
    const kind = assertKind((await ctx.params).kind);
    const { orgId } = await requireOrg();
    return { items: records.list(orgId, kind) };
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  return handler(async () => {
    const kind = assertKind((await ctx.params).kind, true);
    const { session, orgId } = await requireOrg(WRITE_PERMISSION[kind]);
    const data = await body<Record<string, unknown>>(req);
    const record = { ...data, id: (data.id as string) || id(kind.slice(0, 4)), orgId };
    records.put(orgId, kind, record as { id: string });
    audit(session, `${kind}.created`, describe(kind, record));
    return { ok: true, record };
  });
}
