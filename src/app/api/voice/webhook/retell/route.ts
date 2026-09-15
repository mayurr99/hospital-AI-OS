import { legacyPatientById } from "@/lib/server/patients";
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { all, id, nowIso, records, run, settings, writeAudit } from "@/lib/server/db";
import { DEFAULT_VOICE, type VoiceConfig } from "@/lib/server/provision";
import type { CallSession, Patient } from "@/lib/types";

/**
 * Retell webhook receiver.
 *
 * Retell posts call lifecycle events here. The tenant is resolved from the
 * metadata we attached when placing the call, never from anything else in the
 * payload, and the signature is verified against that tenant's own secret.
 */
function verify(secret: string, raw: string, signature: string | null) {
  /*
   * Fail closed.
   *
   * This previously accepted any request when the tenant had not configured a
   * webhook secret — which is the state every tenant starts in. That made a
   * public, unauthenticated endpoint that writes clinical call records: anyone
   * who could guess a hospital's org id could post a fabricated transcript and
   * summary into a patient's chart, and inflate the hospital's billed voice
   * minutes. Falsified clinical documentation is the worst thing this codebase
   * could produce, so an unconfigured secret now means "reject", not "trust".
   */
  if (!secret) return false;
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.replace(/^sha256=/, ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const raw = await req.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const call = (payload.call ?? payload) as Record<string, unknown>;
  const metadata = (call.metadata ?? {}) as Record<string, string>;
  const orgId = metadata.orgId;
  if (!orgId) return NextResponse.json({ error: "Missing tenant metadata" }, { status: 400 });

  const org = all<{ id: string }>("SELECT id FROM organizations WHERE id = ?", [orgId])[0];
  if (!org) return NextResponse.json({ error: "Unknown tenant" }, { status: 404 });

  const voice = settings.get<VoiceConfig>(orgId, "voice", DEFAULT_VOICE);
  if (!verify(voice.retell.webhookSecret, raw, req.headers.get("x-retell-signature"))) {
    writeAudit({ orgId, actor: "retell", actorRole: "super_admin", action: "webhook.signature.invalid", target: String(call.call_id ?? ""), severity: "critical" });
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  const event = String(payload.event ?? call.call_status ?? "unknown");
  const patient = metadata.patientId ? legacyPatientById(orgId, metadata.patientId) as Patient | null : null;

  if (event === "call_ended" || event === "call_analyzed") {
    const durationMs = Number(call.duration_ms ?? 0);
    const seconds = Math.max(1, Math.round(durationMs / 1000));
    const callId = id("call");
    const transcript = Array.isArray(call.transcript_object)
      ? (call.transcript_object as Record<string, unknown>[]).map((t, i) => ({
          speaker: String(t.role) === "agent" ? ("agent" as const) : ("patient" as const),
          text: String(t.content ?? ""),
          atSecond: i * 4,
        }))
      : [];

    if (patient) {
      const record: CallSession = {
        id: callId,
        orgId,
        facilityId: patient.facilityId,
        patientId: patient.id,
        patientName: patient.name,
        phone: patient.phone,
        direction: String(call.direction ?? "outbound") === "inbound" ? "inbound" : "outbound",
        agentId: String(call.agent_id ?? voice.retell.agentId ?? "retell"),
        agentType: metadata.agentType === "receptionist" ? "receptionist" : "care",
        language: patient.language,
        startedAt: new Date(Number(call.start_timestamp ?? Date.now())).toISOString(),
        durationSeconds: seconds,
        status: String(call.disconnection_reason ?? "") === "user_hangup" ? "completed" : "completed",
        outcome: String((call.call_analysis as Record<string, unknown>)?.call_summary ?? "Completed"),
        risk: "green",
        reviewStatus: "pending",
        sentimentScore: 4,
        transcript,
        structured: {},
        summary: String((call.call_analysis as Record<string, unknown>)?.call_summary ?? "Call completed via Retell."),
        recordingAvailable: Boolean(call.recording_url) && patient.consent.recording,
        costRupees: Math.round((seconds / 60) * 4.2 * 100) / 100,
        agentVersion: "retell",
        protocolVersion: records.list<{ version: string }>(orgId, "protocol")[0]?.version ?? "—",
        modelVersion: "retell-live",
      };
      records.put(orgId, "call", record);
      run("UPDATE subscriptions SET voice_minutes_used = voice_minutes_used + ?, updated_at = ? WHERE org_id = ?", [
        Math.max(1, Math.round(seconds / 60)),
        nowIso(),
        orgId,
      ]);
    }
  }

  writeAudit({
    orgId,
    actor: "retell",
    actorRole: "super_admin",
    action: `webhook.${event}`,
    target: String(call.call_id ?? ""),
    severity: "info",
  });

  return NextResponse.json({ ok: true });
}
