import { handler } from "@/lib/server/route";
import { clearSessionCookie, destroySession, getSession } from "@/lib/server/auth";

export async function POST() {
  return handler(async () => {
    const s = await getSession();
    if (s) destroySession(s.token);
    await clearSessionCookie();
    return { ok: true };
  });
}
