import { NextResponse } from "next/server";
import { handler } from "@/lib/server/route";
import { HttpError, audit, requireOrg } from "@/lib/server/auth";
import { get, nowIso, run } from "@/lib/server/db";
import { storageFor } from "@/lib/server/storage";

/** Single-use, short-lived, audited download. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await ctx.params;
    const { session, orgId } = await requireOrg("data.export");
    const token = new URL(req.url).searchParams.get("token");

    const job = get<{
      storage_key: string; download_token: string; expires_at: string; downloaded_at: string | null;
      template: string; rows: number;
    }>("SELECT storage_key, download_token, expires_at, downloaded_at, template, rows FROM export_jobs WHERE id = ? AND org_id = ?", [id, orgId]);

    if (!job) throw new HttpError(404, "Export not found in this hospital");
    if (!token || token !== job.download_token) throw new HttpError(403, "Invalid or missing download token");
    if (new Date(job.expires_at).getTime() < Date.now()) throw new HttpError(410, "This download link has expired — generate the export again");

    const { driver } = storageFor(orgId);
    const obj = await driver.get(job.storage_key);
    if (!obj) throw new HttpError(410, "Export file is no longer available");

    run("UPDATE export_jobs SET downloaded_at = ?, status = 'downloaded' WHERE id = ?", [nowIso(), id]);
    audit(session, "export.downloaded", `${job.template} — ${job.rows} rows`, "critical");

    return new NextResponse(new Uint8Array(obj.body), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${job.template}_${id}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
