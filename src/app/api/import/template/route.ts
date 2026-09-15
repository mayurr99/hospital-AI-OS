import { requireOrg } from "@/lib/server/auth";
import { buildTemplate } from "@/lib/server/importer";
import { handler } from "@/lib/server/route";
import { NextResponse } from "next/server";

/** GET /api/import/template — the standard two-sheet workbook. */
export async function GET() {
  return handler(async () => {
    await requireOrg("data.import");
    const buf = await buildTemplate();
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="hospital-ai-os-patient-import-template.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  });
}
