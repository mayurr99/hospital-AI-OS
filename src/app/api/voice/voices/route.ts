import { handler } from "@/lib/server/route";
import { requireOrg } from "@/lib/server/auth";
import { settings } from "@/lib/server/db";
import { DEFAULT_VOICE, type VoiceConfig } from "@/lib/server/provision";
import { elevenlabs, retell, simulator } from "@/lib/server/voice";

export async function GET() {
  return handler(async () => {
    const { orgId } = await requireOrg("agents.configure");
    const cfg = settings.get<VoiceConfig>(orgId, "voice", DEFAULT_VOICE);
    const voices = cfg.elevenlabs.apiKey ? await elevenlabs.listVoices(cfg.elevenlabs.apiKey) : [];
    const agents = cfg.retell.apiKey ? await retell.listAgents(cfg.retell.apiKey) : [];
    return {
      voices: voices.length ? voices : await simulator.listVoices(),
      agents,
      simulated: voices.length === 0,
    };
  });
}
