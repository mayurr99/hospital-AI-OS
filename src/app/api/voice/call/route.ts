import { legacyPatientById } from "@/lib/server/patients";
import { body, handler } from "@/lib/server/route";
import { HttpError, audit, requireOrg } from "@/lib/server/auth";
import { id, nowIso, records, run, settings } from "@/lib/server/db";
import { DEFAULT_VOICE, getSubscription, type VoiceConfig } from "@/lib/server/provision";
import { placeCall, simulatedAudio } from "@/lib/server/voice";
import { storageFor } from "@/lib/server/storage";
import type { CallSession, Patient } from "@/lib/types";

interface CallBody {
  patientId: string;
  agentType: "care" | "receptionist";
  /** sent when the browser has finished a simulated conversation and wants it persisted */
  finalize?: {
    durationSeconds: number;
    risk: "green" | "amber" | "red";
    transcript: CallSession["transcript"];
    structured: Record<string, string>;
    summary: string;
    outcome: string;
    status: CallSession["status"];
    providerCallId?: string;
  };
}

export async function POST(req: Request) {
  return handler(async () => {
    const { session, orgId } = await requireOrg("calls.initiate");
    const b = await body<CallBody>(req);

    const patient = legacyPatientById(orgId, b.patientId) as Patient | null;
    if (!patient) throw new HttpError(404, "Patient not found in this hospital");

    const sub = getSubscription(orgId);
    if (sub?.status === "trial_expired") throw new HttpError(402, "Trial has ended — add a plan to keep calling patients");
    if (sub && sub.voiceMinutesUsed >= sub.voiceMinutesCap) {
      throw new HttpError(402, "Voice minute cap reached for this billing period");
    }

    /* the consent engine is server-side, so it cannot be bypassed from the client */
    if (b.agentType === "care" && !patient.consent.clinicalCalls) {
      throw new HttpError(403, "Patient has withdrawn consent for automated clinical calls");
    }

    const voice = settings.get<VoiceConfig>(orgId, "voice", DEFAULT_VOICE);

    /* ---- start a call ---- */
    if (!b.finalize) {
      const placed = await placeCall(orgId, patient.phone, { orgId, patientId: patient.id, agentType: b.agentType });
      audit(
        session,
        "call.initiated",
        `${patient.name} · ${b.agentType} · ${placed.provider}${placed.simulated ? " (simulated)" : ""}`,
      );
      return { ...placed, patient: { id: patient.id, name: patient.name, phone: patient.phone } };
    }

    /* ---- persist a finished call ---- */
    const f = b.finalize;
    const callId = id("call");
    const call: CallSession = {
      id: callId,
      orgId,
      facilityId: patient.facilityId,
      patientId: patient.id,
      patientName: patient.name,
      phone: patient.phone,
      direction: b.agentType === "receptionist" ? "inbound" : "outbound",
      agentId: records.list<{ id: string; type: string }>(orgId, "agent").find((a) => a.type === b.agentType)?.id ?? "agent",
      agentType: b.agentType,
      language: patient.language,
      startedAt: new Date(Date.now() - f.durationSeconds * 1000).toISOString(),
      durationSeconds: f.durationSeconds,
      status: f.status,
      outcome: f.outcome,
      risk: f.risk,
      reviewStatus: f.risk === "green" ? "not_required" : "pending",
      sentimentScore: 4,
      transcript: f.transcript,
      structured: f.structured,
      summary: f.summary,
      recordingAvailable: Boolean(voice.recordCalls && patient.consent.recording),
      costRupees: Math.round((f.durationSeconds / 60) * 4.2 * 100) / 100,
      agentVersion: "v1.0",
      protocolVersion: records.list<{ version: string }>(orgId, "protocol")[0]?.version ?? "—",
      modelVersion: voice.telephonyProvider === "retell" ? "retell-live" : "voice-orchestrator-sim",
    };
    records.put(orgId, "call", call);

    /* ---- store the recording through the hospital's own storage driver ---- */
    let recordingId: string | null = null;
    if (call.recordingAvailable) {
      const { driver, config } = storageFor(orgId);
      const audio = simulatedAudio(Math.max(3, Math.min(30, f.durationSeconds)));
      const key = `${new Date().toISOString().slice(0, 10)}/${callId}.wav`;
      const stored = await driver.put(key, audio, "audio/wav");
      recordingId = id("rec");
      const retentionUntil = new Date(Date.now() + config.retentionDays.audio * 86400000).toISOString();
      run(
        `INSERT INTO recordings (id, org_id, call_id, patient_id, storage_kind, storage_key, bytes, duration_secs,
           mime, transcript, consent, retention_until, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          recordingId, orgId, callId, patient.id, driver.kind, stored.key, stored.bytes, f.durationSeconds,
          "audio/wav", JSON.stringify(f.transcript), 1, retentionUntil, nowIso(),
        ],
      );
    }

    /* ---- usage metering ---- */
    run("UPDATE subscriptions SET voice_minutes_used = voice_minutes_used + ?, updated_at = ? WHERE org_id = ?", [
      Math.max(1, Math.round(f.durationSeconds / 60)),
      nowIso(),
      orgId,
    ]);

    records.patch<Patient>(orgId, "patient", patient.id, {
      lastContact: nowIso(),
      risk: f.risk,
    } as Partial<Patient>);

    audit(session, "call.completed", `${call.id} — ${patient.name} — ${f.outcome}`, f.risk === "red" ? "critical" : "info");

    return { ok: true, call, recordingId };
  });
}
