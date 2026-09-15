import { NextResponse } from "next/server";
import { body, handler } from "@/lib/server/route";
import { audit, requireOrg } from "@/lib/server/auth";
import { synthesizePreview } from "@/lib/server/voice";

export async function POST(req: Request) {
  return handler(async () => {
    const { session, orgId } = await requireOrg("agents.configure");
    const { text } = await body<{ text: string }>(req);
    const sample = (text || "नमस्कार, मी हॉस्पिटलची सहाय्यक बोलत आहे.").slice(0, 400);
    const { audio, mime, simulated } = await synthesizePreview(orgId, sample);
    audit(session, "voice.preview", simulated ? "simulator" : "elevenlabs");
    return new NextResponse(new Uint8Array(audio), {
      headers: { "Content-Type": mime, "X-Simulated": simulated ? "1" : "0", "Cache-Control": "no-store" },
    });
  });
}
