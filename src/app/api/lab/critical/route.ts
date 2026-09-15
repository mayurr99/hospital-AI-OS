import { handler } from "@/lib/server/route";
import { requireOrgAny } from "@/lib/server/auth";
import { listCriticalNotifications } from "@/lib/server/labs";

export async function GET(req: Request) {
  return handler(async () => {
    /*
     * Readable by the clinician who must acknowledge a critical result and by
     * the laboratory staff whose job is to telephone the ward about it. The
     * technician could previously record a notification but not see what needed
     * notifying, which left the first step of the workflow invisible to the
     * person who performs it.
     */
    const { orgId } = await requireOrgAny(["escalations.view", "labs.result", "labs.verify"]);
    return { items: listCriticalNotifications(orgId, new URL(req.url).searchParams.get("status") ?? undefined) };
  });
}
