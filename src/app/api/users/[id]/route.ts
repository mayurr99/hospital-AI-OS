import { body, handler } from "@/lib/server/route";
import { HttpError, audit, hashPassword, requireOrg, toSessionUser, type DbUser } from "@/lib/server/auth";
import { get, nowIso, run } from "@/lib/server/db";
import { ROLE_LABELS } from "@/lib/rbac";
import type { Permission, Role } from "@/lib/types";

interface PatchBody {
  name?: string; phone?: string; role?: Role; status?: "active" | "invited" | "suspended";
  facilityId?: string | null; departmentId?: string | null; mfaEnabled?: boolean;
  extraPermissions?: Permission[]; revokedPermissions?: Permission[]; password?: string;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await ctx.params;
    const { session, orgId } = await requireOrg("users.manage");
    const existing = get<DbUser>("SELECT * FROM users WHERE id = ? AND org_id = ?", [id, orgId]);
    if (!existing) throw new HttpError(404, "User not found in this hospital");
    const b = await body<PatchBody>(req);
    if (b.role === "super_admin") throw new HttpError(403, "Platform roles cannot be granted here");

    run(
      `UPDATE users SET name = ?, phone = ?, role = ?, status = ?, facility_id = ?, department_id = ?,
         mfa_enabled = ?, extra_perms = ?, revoked_perms = ?, password_hash = COALESCE(?, password_hash)
       WHERE id = ? AND org_id = ?`,
      [
        b.name ?? existing.name,
        b.phone ?? existing.phone,
        b.role ?? existing.role,
        b.status ?? existing.status,
        b.facilityId === undefined ? existing.facility_id : b.facilityId,
        b.departmentId === undefined ? existing.department_id : b.departmentId,
        b.mfaEnabled === undefined ? existing.mfa_enabled : b.mfaEnabled ? 1 : 0,
        JSON.stringify(b.extraPermissions ?? JSON.parse(existing.extra_perms)),
        JSON.stringify(b.revokedPermissions ?? JSON.parse(existing.revoked_perms)),
        b.password ? hashPassword(b.password) : null,
        id, orgId,
      ],
    );

    /* suspending revokes every live session immediately */
    /*
     * A password change ends every existing session for that user.
     *
     * Resetting the password of a compromised account is the one action an
     * administrator takes in an incident, and without this it achieved nothing:
     * the attacker's thirty-day cookie kept working, and the admin had no way
     * to know.
     */
    if (b.password) run("DELETE FROM sessions WHERE user_id = ?", [id]);
    if (b.status === "suspended") run("DELETE FROM sessions WHERE user_id = ?", [id]);

    const updated = get<DbUser>("SELECT * FROM users WHERE id = ?", [id])!;
    audit(
      session,
      b.status === "suspended" ? "user.suspended" : "user.updated",
      `${updated.name} — ${ROLE_LABELS[updated.role]}, ${updated.status}`,
      b.status === "suspended" ? "critical" : "warning",
    );
    void nowIso;
    return { ok: true, user: toSessionUser(updated) };
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const { id } = await ctx.params;
    const { session, orgId } = await requireOrg("users.manage");
    if (id === session.user.id) throw new HttpError(400, "You cannot remove your own account");
    const existing = get<DbUser>("SELECT * FROM users WHERE id = ? AND org_id = ?", [id, orgId]);
    if (!existing) throw new HttpError(404, "User not found in this hospital");
    run("DELETE FROM sessions WHERE user_id = ?", [id]);
    run("DELETE FROM users WHERE id = ? AND org_id = ?", [id, orgId]);
    audit(session, "user.removed", `${existing.name} (${existing.email})`, "critical");
    return { ok: true };
  });
}
