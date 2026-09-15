import { handler } from "@/lib/server/route";
import { requireOrg } from "@/lib/server/auth";
import { all, settings } from "@/lib/server/db";
import { DEFAULT_STORAGE, type StorageConfig } from "@/lib/server/provision";
import { storageFor } from "@/lib/server/storage";

export async function GET() {
  return handler(async () => {
    const { orgId } = await requireOrg("calls.view");
    const rows = all<Record<string, unknown>>(
      "SELECT * FROM recordings WHERE org_id = ? ORDER BY created_at DESC LIMIT 300", [orgId],
    );
    const cfg = settings.get<StorageConfig>(orgId, "storage", DEFAULT_STORAGE);
    const { driver } = storageFor(orgId);
    return {
      storage: { driver: cfg.driver, describe: driver.describe(), retentionDays: cfg.retentionDays, verifiedAt: cfg.verifiedAt },
      recordings: rows.map((r) => ({
        id: r.id, callId: r.call_id, patientId: r.patient_id, storageKind: r.storage_kind,
        storageKey: r.storage_key, bytes: r.bytes, durationSeconds: r.duration_secs, mime: r.mime,
        consent: Boolean(r.consent), retentionUntil: r.retention_until, createdAt: r.created_at,
        transcript: JSON.parse(String(r.transcript || "[]")),
      })),
    };
  });
}
