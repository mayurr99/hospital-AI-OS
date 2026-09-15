import { body, handler } from "@/lib/server/route";
import { HttpError, audit, requireOrg } from "@/lib/server/auth";
import { getPatient, updatePatient, listAllergies } from "@/lib/server/patients";
import { listAdmissions, listWardAssignments } from "@/lib/server/admissions";
import { listEncounters, listVitals, listDiagnoses, listMedications, listDocuments } from "@/lib/server/clinicaldata";
import { listLabOrders } from "@/lib/server/labs";
import { listEvents, listClinicalAudit } from "@/lib/server/domain";
import { listCharges } from "@/lib/server/charges";
import { validatePatient } from "@/lib/server/validate";
import { userCan } from "@/lib/server/auth";

/**
 * GET /api/patients/:id — the whole chart in one tenant-scoped payload.
 * Clinical sections are omitted entirely (not merely hidden) for a user without
 * `patients.clinical.view`, so reception cannot read them from the network tab.
 */
export async function GET(_req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const { orgId, session } = await requireOrg("patients.view");
    const patient = getPatient(orgId, id);
    const clinical = userCan(session.user, "patients.clinical.view");

    const admissions = listAdmissions(orgId, { patientId: id });
    const current = admissions.find((a) => a.status === "ACTIVE") ?? null;

    return {
      patient,
      clinicalVisible: clinical,
      admissions,
      currentAdmission: current,
      wardHistory: current ? listWardAssignments(orgId, current.id) : [],
      allergies: clinical ? listAllergies(orgId, id) : [],
      vitals: clinical ? listVitals(orgId, id, 60) : [],
      diagnoses: clinical ? listDiagnoses(orgId, id) : [],
      medications: clinical ? listMedications(orgId, id) : [],
      encounters: clinical ? listEncounters(orgId, { patientId: id }) : [],
      labOrders: clinical ? listLabOrders(orgId, { patientId: id }) : [],
      documents: listDocuments(orgId, id),
      /* Charges raised by this patient's own clinical events. */
      charges: userCan(session.user, "billing.manage") ? listCharges(orgId, { patientId: id }) : [],
      timeline: listEvents(orgId, id),
      audit: userCan(session.user, "audit.view") ? listClinicalAudit(orgId, id) : [],
    };
  });
}

/** PATCH /api/patients/:id — demographics only. Clinical data has its own routes. */
export async function PATCH(req: Request, c: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await c.params;
    const ctx = await requireOrg("patients.edit");
    const input = await body<Record<string, unknown>>(req);
    getPatient(ctx.orgId, id); // 404s before any validation work if it is another tenant's id

    const { check, value } = validatePatient({ ...input, firstName: input.firstName ?? "placeholder" });
    check.issues = check.issues.filter((i) => i.field !== "firstName" || "firstName" in input);
    check.throwIfAny();

    /*
     * Refuse a field this endpoint does not write, rather than dropping it.
     *
     * The loop below keeps only keys the demographic validator recognises,
     * which is the right way to stop a caller smuggling in `orgId` or `uhid`.
     * But silently discarding the rest means somebody who sends `phone`
     * instead of `mobile` gets `ok: true` and a record that did not change —
     * they believe they corrected the number, and the ward rings the old one.
     */
    const CONTROL_KEYS = new Set(["expectedVersion", "reason", "consent", "id", "orgId", "version", "forceCreate"]);
    const unknown = Object.keys(input).filter((k) => !(k in value) && !CONTROL_KEYS.has(k));
    if (unknown.length) {
      throw new HttpError(
        422,
        `Not a patient field: ${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? ` and ${unknown.length - 5} more` : ""}`,
      );
    }

    const patch: Record<string, unknown> = {};
    for (const k of Object.keys(input)) {
      if (k in value) patch[k] = (value as Record<string, unknown>)[k];
    }
    // Consent is not a demographic field, so it does not come back from the
    // demographic validator — carry it through explicitly.
    if (input.consent && typeof input.consent === "object") {
      patch.consent = { ...(input.consent as Record<string, unknown>), updatedAt: new Date().toISOString() };
    }
    delete patch.uhid;
    /*
     * Carry through the version the client was editing. The validator strips
     * anything that is not a demographic field, so it has to be re-attached
     * here — without it every save is a blind overwrite.
     */
    if (input.expectedVersion !== undefined) patch.expectedVersion = input.expectedVersion;
    const patient = updatePatient(ctx, id, patch, String(input.reason ?? ""));
    audit(ctx.session, "patient.updated", `Patient ${patient.fullName} (${patient.uhid})`);
    return { ok: true, patient };
  });
}
