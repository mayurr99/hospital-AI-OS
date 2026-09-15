import { body, handler } from "@/lib/server/route";
import { requireOrg, HttpError } from "@/lib/server/auth";
import {
  assignBed, dischargeAdmission, getAdmission, listWardAssignments, transferAdmission,
} from "@/lib/server/admissions";

export async function GET(_req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const { orgId } = await requireOrg("patients.view");
    return { admission: getAdmission(orgId, id), wardHistory: listWardAssignments(orgId, id) };
  });
}

/**
 * POST /api/admissions/:id with an `action`:
 *   assign-bed · transfer · discharge
 * Each one is a single atomic domain operation, not a field update.
 */
export async function POST(req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const ctx = await requireOrg("admissions.manage");
    const input = await body<Record<string, unknown>>(req);
    const action = String(input.action ?? "");

    if (action === "assign-bed") {
      return { ok: true, admission: assignBed(ctx, id, String(input.bedId ?? ""), String(input.reason ?? "")) };
    }
    if (action === "transfer") {
      return {
        ok: true,
        admission: transferAdmission(ctx, id, {
          toBedId: String(input.toBedId ?? ""),
          reason: String(input.reason ?? ""),
          authorizedBy: String(input.authorizedBy ?? ""),
        }),
      };
    }
    if (action === "discharge") {
      return {
        ok: true,
        admission: dischargeAdmission(ctx, id, {
          dischargedAt: input.dischargedAt as string,
          dischargeType: input.dischargeType as string,
          finalDiagnosis: String(input.finalDiagnosis ?? ""),
          dischargeSummary: String(input.dischargeSummary ?? ""),
          instructions: input.instructions as string,
          procedures: input.procedures as string,
          dischargeDoctorId: (input.dischargeDoctorId as string) ?? null,
          followupDate: (input.followupDate as string) ?? null,
        }),
      };
    }
    throw new HttpError(400, "Unknown action. Use assign-bed, transfer or discharge.");
  });
}
