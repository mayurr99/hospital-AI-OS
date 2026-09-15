import { body, handler } from "@/lib/server/route";
import { HttpError, audit, requireOrg } from "@/lib/server/auth";
import { nowIso, settings } from "@/lib/server/db";
import { DEFAULT_STORAGE, DEFAULT_VOICE, type StorageConfig, type VoiceConfig } from "@/lib/server/provision";
import { storageFromConfig } from "@/lib/server/storage";
import { keyStatus } from "@/lib/server/encryption";
import { elevenlabs, retell, simulator } from "@/lib/server/voice";

/** Live connection tests. Real HTTP where keys exist; honest answer where they do not. */
export async function POST(req: Request) {
  return handler(async () => {
    const { session, orgId } = await requireOrg("org.configure");
    const b = await body<{ target: "storage" | "retell" | "elevenlabs" }>(req);

    if (b.target === "storage") {
      const cfg = settings.get<StorageConfig>(orgId, "storage", DEFAULT_STORAGE);
      const result = await storageFromConfig(orgId, cfg).test();
      if (result.ok) settings.set(orgId, "storage", { ...cfg, verifiedAt: nowIso() });
      audit(session, "storage.tested", `${cfg.driver} — ${result.ok ? "ok" : "failed"}: ${result.detail}`, "warning");
      /*
       * Report what is actually true of the deployment, not what the toggle
       * says. Encryption at rest depends on a key held in the environment, and
       * an administrator has no other way to find out whether one is there.
       */
      return { ...result, driver: cfg.driver, encryption: keyStatus() };
    }

    const voice = settings.get<VoiceConfig>(orgId, "voice", DEFAULT_VOICE);

    if (b.target === "retell") {
      if (!voice.retell.apiKey) {
        const sim = await simulator.test();
        return { ...sim, simulated: true };
      }
      const result = await retell.test(voice.retell.apiKey);
      if (result.ok) settings.set(orgId, "voice", { ...voice, retell: { ...voice.retell, verifiedAt: nowIso() } });
      audit(session, "voice.retell.tested", result.detail, "warning");
      return { ...result, simulated: false };
    }

    if (b.target === "elevenlabs") {
      if (!voice.elevenlabs.apiKey) {
        const sim = await simulator.test();
        return { ...sim, simulated: true };
      }
      const result = await elevenlabs.test(voice.elevenlabs.apiKey);
      if (result.ok) settings.set(orgId, "voice", { ...voice, elevenlabs: { ...voice.elevenlabs, verifiedAt: nowIso() } });
      audit(session, "voice.elevenlabs.tested", result.detail, "warning");
      return { ...result, simulated: false };
    }

    throw new HttpError(400, "Unknown test target");
  });
}
