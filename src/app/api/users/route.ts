import { body, handler } from "@/lib/server/route";
import { HttpError, audit, createUser, findUserByEmail, requireOrg, toSessionUser, type DbUser } from "@/lib/server/auth";
import { all, get } from "@/lib/server/db";
import { getSubscription } from "@/lib/server/provision";
import { ROLE_LABELS } from "@/lib/rbac";
import type { Role } from "@/lib/types";

export async function GET() {
  return handler(async () => {
    const { orgId } = await requireOrg("users.manage");
    const users = all<DbUser>("SELECT * FROM users WHERE org_id = ? ORDER BY created_at DESC", [orgId]);
    return { users: users.map(toSessionUser) };
  });
}

export async function POST(req: Request) {
  return handler(async () => {
    const { session, orgId } = await requireOrg("users.manage");
    const b = await body<{
      name: string; email: string; phone?: string; role: Role;
      facilityId?: string | null; departmentId?: string | null; mfaEnabled?: boolean; password?: string;
    }>(req);

    if (!b.name?.trim()) throw new HttpError(400, "Name is required");
    if (!b.email?.trim()) throw new HttpError(400, "Email is required");
    if (b.role === "super_admin") throw new HttpError(403, "Platform roles cannot be granted from a hospital workspace");
    if (findUserByEmail(b.email.trim(), orgId)) throw new HttpError(409, "A user with this email already exists in this hospital");

    const sub = getSubscription(orgId);
    const count = get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE org_id = ?", [orgId])?.n ?? 0;
    if (sub && count >= sub.seats) throw new HttpError(402, `Seat limit reached (${sub.seats}) — upgrade the plan to invite more staff`);

    const created = createUser({
      orgId,
      name: b.name.trim(),
      email: b.email.trim().toLowerCase(),
      phone: b.phone,
      role: b.role,
      facilityId: b.facilityId ?? null,
      departmentId: b.departmentId ?? null,
      status: b.password ? "active" : "invited",
      mfaEnabled: b.mfaEnabled,
      password: b.password,
    });
    audit(session, "user.invited", `${created.name} (${ROLE_LABELS[b.role]})`, "warning");
    return { ok: true, user: toSessionUser(created) };
  });
}
