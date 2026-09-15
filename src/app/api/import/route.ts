import { handler } from "@/lib/server/route";
import { requireOrg, HttpError } from "@/lib/server/auth";
import {
  autoMap, buildPreview, COLUMNS, getSavedMapping, listBatches, parseWorkbook, saveBatch, saveMapping,
} from "@/lib/server/importer";

/** GET /api/import — import history plus the column dictionary the UI maps against. */
export async function GET() {
  return handler(async () => {
    const { orgId } = await requireOrg("data.import");
    return {
      batches: listBatches(orgId),
      columns: COLUMNS,
      savedMapping: { PATIENTS: getSavedMapping(orgId, "PATIENTS"), ADMISSIONS: getSavedMapping(orgId, "ADMISSIONS") },
    };
  });
}

/**
 * POST /api/import — upload, map, validate and preview.
 *
 * Nothing is written to the patient tables here. The response is the preview the
 * operator reviews before committing.
 */
export async function POST(req: Request) {
  return handler(async () => {
    const ctx = await requireOrg("data.import");

    const form = await req.formData().catch(() => null);
    if (!form) throw new HttpError(400, "Upload the file as multipart/form-data");
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "No file was uploaded");
    if (file.size > 12 * 1024 * 1024) throw new HttpError(413, "That file is larger than 12 MB — split it and import in parts");

    const buf = Buffer.from(await file.arrayBuffer());
    const sheets = await parseWorkbook(buf, file.name);

    // An operator-corrected mapping wins; otherwise this hospital's remembered
    // mapping; otherwise the synonym dictionary.
    const override = safeJson(form.get("mapping"));
    const detected: Record<string, { headers: string[]; unmapped: string[] }> = {};
    const mapping = { PATIENTS: {} as Record<string, string>, ADMISSIONS: {} as Record<string, string> };

    for (const sheetName of ["PATIENTS", "ADMISSIONS"] as const) {
      const sheet = sheets.find((s) => s.name === sheetName) ?? (sheetName === "PATIENTS" ? sheets[0] : undefined);
      if (!sheet) continue;
      const saved = { ...getSavedMapping(ctx.orgId, sheetName), ...(override?.[sheetName] ?? {}) };
      const { mapping: m, unmapped } = autoMap(sheet.headers, sheetName, saved);
      mapping[sheetName] = m;
      detected[sheetName] = { headers: sheet.headers, unmapped };
    }

    if (!Object.values(mapping.PATIENTS).includes("firstName") && !Object.values(mapping.PATIENTS).includes("fullName")) {
      throw new HttpError(422, "No name column could be identified. Map one of your columns to First_Name or Patient_Name and upload again.");
    }

    const preview = buildPreview({ orgId: ctx.orgId, sheets, mapping });

    // Remember the mapping for this hospital's next import.
    saveMapping(ctx, "PATIENTS", mapping.PATIENTS);
    if (Object.keys(mapping.ADMISSIONS).length) saveMapping(ctx, "ADMISSIONS", mapping.ADMISSIONS);

    const batchId = saveBatch(ctx, {
      filename: file.name, bytes: file.size, mapping, detectedHeaders: detected,
      options: {}, patientRows: preview.patientRows, admissionRows: preview.admissionRows, summary: preview.summary,
    });

    return {
      ok: true, batchId, mapping, detected,
      summary: preview.summary,
      patientRows: preview.patientRows,
      admissionRows: preview.admissionRows,
    };
  });
}

function safeJson(v: FormDataEntryValue | null): Record<string, Record<string, string>> | null {
  if (typeof v !== "string" || !v) return null;
  try {
    return JSON.parse(v) as Record<string, Record<string, string>>;
  } catch {
    return null;
  }
}
