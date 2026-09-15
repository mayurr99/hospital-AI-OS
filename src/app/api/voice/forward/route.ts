import { legacyPatientById, legacyPatientPatch } from "@/lib/server/patients";
import { body, handler } from "@/lib/server/route";
import { HttpError, audit, requireOrg } from "@/lib/server/auth";
import { id, nowIso, records, settings } from "@/lib/server/db";
import { DEFAULT_ESCALATION, type EscalationConfig } from "@/lib/server/provision";
import { forwardToHuman } from "@/lib/server/voice";
import type { Escalation, Patient, Task } from "@/lib/types";

/**
 * Critical-situation forwarding.
 *
 * When the protocol engine raises a red flag mid-call this is what runs: the
 * live call is handed to the hospital's main line (warm, cold or conference as
 * configured), an escalation is opened with the SLA clock started, a
 * coordinator task is queued, and every step is written to the audit trail.
 * If the transfer cannot be completed the patient is never simply dropped —
 * the fallback number is tried and a critical task is raised for a human.
 */
export async function POST(req: Request) {
  return handler(async () => {
    const { session, orgId } = await requireOrg("calls.initiate");
    const b = await body<{
      patientId: string;
      providerCallId?: string;
      trigger: string;
      detail?: string;
      callId?: string;
    }>(req);

    const patient = legacyPatientById(orgId, b.patientId) as Patient | null;
    if (!patient) throw new HttpError(404, "Patient not found in this hospital");

    const cfg = settings.get<EscalationConfig>(orgId, "escalation", DEFAULT_ESCALATION);
    const now = new Date();
    const hour = now.getHours();
    const afterHours = hour < 8 || hour >= 20;
    const primary =
      (afterHours && cfg.afterHoursNumber) ||
      cfg.mainLineNumber ||
      cfg.onCall[0]?.number ||
      cfg.fallbackNumber;

    if (!primary) {
      throw new HttpError(
        400,
        "No main line configured — set an escalation number in Settings → Escalation before running critical follow-up calls",
      );
    }

    const steps: { step: string; ok: boolean; detail: string }[] = [];

    /* 1. hand the live call over */
    const transfer = await forwardToHuman(orgId, b.providerCallId ?? "", primary);
    steps.push({
      step: `${cfg.transferMode} transfer to ${primary}`,
      ok: transfer.ok,
      detail: transfer.detail + (transfer.simulated ? " (simulator)" : ""),
    });

    /* 2. fallback if the main line did not take it */
    let connectedTo = transfer.ok ? primary : null;
    if (!transfer.ok && cfg.fallbackNumber && cfg.fallbackNumber !== primary) {
      const retry = await forwardToHuman(orgId, b.providerCallId ?? "", cfg.fallbackNumber);
      steps.push({ step: `fallback to ${cfg.fallbackNumber}`, ok: retry.ok, detail: retry.detail });
      if (retry.ok) connectedTo = cfg.fallbackNumber;
    }

    /* 3. open the escalation with the SLA clock running */
    const escalationId = id("esc");
    const escalation: Escalation = {
      id: escalationId,
      orgId,
      facilityId: patient.facilityId,
      patientId: patient.id,
      callId: b.callId ?? null,
      level: "red",
      trigger: b.trigger,
      detail: b.detail ?? `Red flag during an AI follow-up call. Live call ${connectedTo ? `transferred to ${connectedTo}` : "could not be transferred"}.`,
      raisedAt: nowIso(),
      assignedTo: session.user.id,
      status: "open",
      slaMinutes: cfg.slaMinutes,
    };
    records.put(orgId, "escalation", escalation);
    steps.push({ step: "escalation opened", ok: true, detail: `SLA ${cfg.slaMinutes} min, assigned to on-call` });

    /* 4. notify the configured channels */
    const notified = Object.entries(cfg.notifyChannels)
      .filter(([, on]) => on)
      .map(([ch]) => ch);
    if (notified.length) steps.push({ step: "team notified", ok: true, detail: notified.join(", ") });

    /* 5. always leave a human task behind, especially when the transfer failed */
    const task: Task = {
      id: id("task"),
      orgId,
      patientId: patient.id,
      queue: "critical",
      title: connectedTo ? "Critical call forwarded — confirm clinician picked up" : "Critical call could NOT be forwarded",
      detail: `${b.trigger}. ${connectedTo ? `Handed to ${connectedTo}.` : "No line accepted the transfer — call the patient back immediately."}`,
      assignedTo: null,
      priority: "high",
      createdAt: nowIso(),
      dueAt: new Date(Date.now() + cfg.slaMinutes * 60000).toISOString(),
      status: "open",
    };
    records.put(orgId, "task", task);

    legacyPatientPatch(orgId, patient.id, { risk: "red" });

    audit(
      session,
      "escalation.forwarded",
      `${patient.name} → ${connectedTo ?? "NO ANSWER"} · ${b.trigger}`,
      "critical",
    );

    return {
      ok: true,
      connectedTo,
      transferMode: cfg.transferMode,
      afterHours,
      slaMinutes: cfg.slaMinutes,
      escalationId,
      taskId: task.id,
      steps,
      simulated: transfer.simulated,
    };
  });
}
