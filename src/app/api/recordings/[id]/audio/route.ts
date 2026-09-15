import { NextResponse } from "next/server";
import { handler } from "@/lib/server/route";
import { HttpError, audit, requireOrg } from "@/lib/server/auth";
import { get } from "@/lib/server/db";
import { storageFor } from "@/lib/server/storage";

/** Playback is permission-gated and every play writes an audit event. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await ctx.params;
    const { session, orgId } = await requireOrg("calls.listen");
    const row = get<{ storage_key: string; mime: string; call_id: string; patient_id: string }>(
      "SELECT storage_key, mime, call_id, patient_id FROM recordings WHERE id = ? AND org_id = ?", [id, orgId],
    );
    if (!row) throw new HttpError(404, "Recording not found in this hospital");
    const { driver } = storageFor(orgId);
    const obj = await driver.get(row.storage_key);
    if (!obj) throw new HttpError(410, "Recording has been purged under the retention policy");
    audit(session, "call.recording.played", `${row.call_id} (${driver.kind} storage)`, "warning");
    return new NextResponse(new Uint8Array(obj.body), {
      headers: { "Content-Type": obj.mime || row.mime, "Cache-Control": "no-store", "Accept-Ranges": "bytes" },
    });
  });
}
