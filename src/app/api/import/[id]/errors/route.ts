import { requireOrg } from "@/lib/server/auth";
import { errorReportCsv } from "@/lib/server/importer";
import { handler } from "@/lib/server/route";
import { NextResponse } from "next/server";

/** GET /api/import/:id/errors — a row-level error report the operator can fix from. */
export async function GET(_req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const { orgId } = await requireOrg("data.import");
    const csv = errorReportCsv(orgId, id);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="import-errors-${id}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
