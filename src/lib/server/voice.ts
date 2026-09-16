import { settings } from "./db";
import { DEFAULT_VOICE, type VoiceConfig } from "./provision";

/**
 * Voice providers.
 *
 * Everything the application needs from a voice vendor sits behind this one
 * interface, so no vendor becomes an architectural dependency. Two real
 * implementations ship (Retell for telephony + conversation, ElevenLabs for
 * speech synthesis) plus a built-in simulator that keeps the product fully
 * demonstrable with no keys and no spend.
 */

export interface VoiceInfo {
  id: string;
  name: string;
  labels?: string;
  previewUrl?: string;
}

export interface PlacedCall {
  providerCallId: string;
  status: string;
  provider: string;
  simulated: boolean;
  detail?: string;
}

export interface ProviderTest {
  ok: boolean;
  detail: string;
  meta?: Record<string, unknown>;
}

const TIMEOUT_MS = 12000;

async function fetchJson(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; body: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

/* ------------------------------- Retell --------------------------- */

const RETELL_BASE = "https://api.retellai.com";

export const retell = {
  async test(apiKey: string): Promise<ProviderTest> {
    if (!apiKey) return { ok: false, detail: "No API key set" };
    try {
      const res = await fetchJson(`${RETELL_BASE}/list-agents`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        return { ok: false, detail: `Retell returned ${res.status}${res.status === 401 ? " — check the API key" : ""}` };
      }
      const agents = Array.isArray(res.body) ? res.body : [];
      return {
        ok: true,
        detail: `Connected — ${agents.length} agent${agents.length === 1 ? "" : "s"} visible on this key`,
        meta: { agents: agents.slice(0, 25) },
      };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? `Could not reach Retell: ${e.message}` : "Network error" };
    }
  },

  async listAgents(apiKey: string): Promise<{ id: string; name: string }[]> {
    if (!apiKey) return [];
    try {
      const res = await fetchJson(`${RETELL_BASE}/list-agents`, { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } });
      if (!res.ok || !Array.isArray(res.body)) return [];
      return (res.body as Record<string, unknown>[]).map((a) => ({
        id: String(a.agent_id ?? a.id ?? ""),
        name: String(a.agent_name ?? a.name ?? "Unnamed agent"),
      }));
    } catch {
      return [];
    }
  },

  async createCall(cfg: VoiceConfig, to: string, metadata: Record<string, unknown>): Promise<PlacedCall> {
    const { apiKey, agentId, fromNumber } = cfg.retell;
    const res = await fetchJson(`${RETELL_BASE}/v2/create-phone-call`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from_number: fromNumber,
        to_number: to,
        override_agent_id: agentId || undefined,
        metadata,
      }),
    });
    if (!res.ok) {
      const detail = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
      throw new Error(`Retell create-phone-call failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const body = res.body as Record<string, unknown>;
    return {
      providerCallId: String(body.call_id ?? body.callId ?? ""),
      status: String(body.call_status ?? "registered"),
      provider: "retell",
      simulated: false,
    };
  },

  /** Ask Retell to hand the live call to a human number. */
  async transferCall(apiKey: string, callId: string, toNumber: string): Promise<{ ok: boolean; detail: string }> {
    const res = await fetchJson(`${RETELL_BASE}/v2/transfer-call/${callId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ transfer_to: toNumber }),
    });
    return { ok: res.ok, detail: res.ok ? `Transferred to ${toNumber}` : `Transfer failed (${res.status})` };
  },

  async getCall(apiKey: string, callId: string) {
    const res = await fetchJson(`${RETELL_BASE}/v2/get-call/${callId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return res.ok ? (res.body as Record<string, unknown>) : null;
  },
};

/* ----------------------------- ElevenLabs -------------------------- */

const ELEVEN_BASE = "https://api.elevenlabs.io/v1";

export const elevenlabs = {
  async test(apiKey: string): Promise<ProviderTest> {
    if (!apiKey) return { ok: false, detail: "No API key set" };
    try {
      const res = await fetchJson(`${ELEVEN_BASE}/user/subscription`, {
        method: "GET",
        headers: { "xi-api-key": apiKey },
      });
      if (!res.ok) {
        return { ok: false, detail: `ElevenLabs returned ${res.status}${res.status === 401 ? " — check the API key" : ""}` };
      }
      const b = res.body as Record<string, unknown>;
      const used = Number(b.character_count ?? 0);
      const limit = Number(b.character_limit ?? 0);
      return {
        ok: true,
        detail: `Connected — ${b.tier ?? "account"} tier, ${used.toLocaleString()} of ${limit.toLocaleString()} characters used`,
        meta: { tier: b.tier, used, limit },
      };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? `Could not reach ElevenLabs: ${e.message}` : "Network error" };
    }
  },

  async listVoices(apiKey: string): Promise<VoiceInfo[]> {
    if (!apiKey) return [];
    try {
      const res = await fetchJson(`${ELEVEN_BASE}/voices`, { method: "GET", headers: { "xi-api-key": apiKey } });
      if (!res.ok) return [];
      const voices = (res.body as { voices?: Record<string, unknown>[] }).voices ?? [];
      return voices.map((v) => ({
        id: String(v.voice_id ?? ""),
        name: String(v.name ?? "Voice"),
        labels: Object.values((v.labels as Record<string, string>) ?? {}).join(" · "),
        previewUrl: v.preview_url ? String(v.preview_url) : undefined,
      }));
    } catch {
      return [];
    }
  },

  async synthesize(cfg: VoiceConfig["elevenlabs"], text: string): Promise<{ audio: Buffer; mime: string }> {
    const res = await fetch(`${ELEVEN_BASE}/text-to-speech/${cfg.voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": cfg.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: cfg.model || "eleven_multilingual_v2",
        voice_settings: { stability: cfg.stability, similarity_boost: cfg.similarity },
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs TTS failed (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { audio: buf, mime: "audio/mpeg" };
  },
};

/* ------------------------------ simulator -------------------------- */

/** A tiny synthesised WAV so recording, storage and playback are exercised end to end without a vendor. */
export function simulatedAudio(seconds = 6): Buffer {
  const sampleRate = 8000;
  const samples = sampleRate * seconds;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const envelope = 0.35 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.4 * t));
    const tone = Math.sin(2 * Math.PI * 196 * t) * 0.6 + Math.sin(2 * Math.PI * 294 * t) * 0.4;
    data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(tone * envelope * 32767))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export const simulator = {
  async test(): Promise<ProviderTest> {
    return { ok: true, detail: "Built-in simulator active — calls are generated locally, nothing leaves this server" };
  },
  async createCall(to: string): Promise<PlacedCall> {
    return {
      providerCallId: `sim_${Date.now().toString(36)}`,
      status: "in_progress",
      provider: "simulator",
      simulated: true,
      detail: `Simulated outbound call to ${to}`,
    };
  },
  async listVoices(): Promise<VoiceInfo[]> {
    return [
      { id: "sim_aarohi", name: "Aarohi — Marathi (female, warm)", labels: "marathi · warm" },
      { id: "sim_kavya", name: "Kavya — Hindi (female, calm)", labels: "hindi · calm" },
      { id: "sim_neha", name: "Neha — English India (female, clear)", labels: "english · clear" },
      { id: "sim_arjun", name: "Arjun — Hindi (male, steady)", labels: "hindi · steady" },
    ];
  },
};

/* ------------------------------ facade ----------------------------- */

export function voiceConfigFor(orgId: string): VoiceConfig {
  return settings.get<VoiceConfig>(orgId, "voice", DEFAULT_VOICE);
}

export async function placeCall(orgId: string, to: string, metadata: Record<string, unknown>): Promise<PlacedCall> {
  const cfg = voiceConfigFor(orgId);
  if (cfg.telephonyProvider === "retell") {
    if (!cfg.retell.apiKey || !cfg.retell.fromNumber) {
      throw new Error("Retell is selected but its API key or outbound number is missing");
    }
    return retell.createCall(cfg, to, metadata);
  }
  return simulator.createCall(to);
}

export async function forwardToHuman(
  orgId: string,
  providerCallId: string,
  toNumber: string,
): Promise<{ ok: boolean; detail: string; simulated: boolean }> {
  const cfg = voiceConfigFor(orgId);
  if (cfg.telephonyProvider === "retell") {
    if (!cfg.retell.apiKey || !providerCallId || providerCallId.startsWith("sim_")) {
      return { ok: false, detail: "The live call cannot be transferred because Retell is not fully connected", simulated: false };
    }
    const r = await retell.transferCall(cfg.retell.apiKey, providerCallId, toNumber);
    return { ...r, simulated: false };
  }
  return { ok: true, detail: `Simulated warm transfer to ${toNumber}`, simulated: true };
}

export async function synthesizePreview(orgId: string, text: string): Promise<{ audio: Buffer; mime: string; simulated: boolean }> {
  const cfg = voiceConfigFor(orgId);
  if (cfg.ttsProvider === "elevenlabs" && cfg.elevenlabs.apiKey && cfg.elevenlabs.voiceId) {
    try {
      const r = await elevenlabs.synthesize(cfg.elevenlabs, text);
      return { ...r, simulated: false };
    } catch {
      /* fall through to simulator */
    }
  }
  return { audio: simulatedAudio(4), mime: "audio/wav", simulated: true };
}
