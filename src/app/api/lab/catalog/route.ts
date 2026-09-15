import { handler } from "@/lib/server/route";
import { requireOrg } from "@/lib/server/auth";
import { listTests } from "@/lib/server/labs";

export async function GET() {
  return handler(async () => {
    const { orgId } = await requireOrg("patients.view");
    return { items: listTests(orgId) };
  });
}
