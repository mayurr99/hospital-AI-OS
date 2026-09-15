import { body, handler } from "@/lib/server/route";
import { requireOrg } from "@/lib/server/auth";
import { commitBatch, getBatch, type CommitOptions } from "@/lib/server/importer";

export async function GET(_req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const { orgId } = await requireOrg("data.import");
    return getBatch(orgId, id);
  });
}

/** POST /api/import/:id — commit the previewed batch with the operator's decisions. */
export async function POST(req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const ctx = await requireOrg("data.import");
    const input = await body<CommitOptions>(req);
    const result = commitBatch(ctx, id, input);
    return { ok: true, ...result, ...getBatch(ctx.orgId, id) };
  });
}
