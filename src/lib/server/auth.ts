import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { all, get, id, nowIso, run, writeAudit } from "./db";
import type { Permission, Role } from "@/lib/types";
import { ROLE_PERMISSIONS } from "@/lib/rbac";

export const SESSION_COOKIE = "hos_session";
/**
 * Sessions last a week, not a month.
 *
 * Thirty days is a long time for a stolen cookie to stay useful on a system
 * holding medical records, and a shift worker signs in far more often than
 * that anyway. A shorter life costs a little convenience and removes three
 * weeks of exposure from every laptop left in a taxi.
 */
const SESSION_DAYS = 7;

/* --------------------------- passwords ---------------------------- */

/**
 * scrypt work factor.
 *
 * Node's default is N=2^14, which is eight times cheaper than the current OWASP
 * floor of 2^17 — meaning an exfiltrated user table is eight times faster to
 * crack. The cost is paid once per sign-in and is imperceptible there; it is
 * paid millions of times by anyone attacking a stolen database, which is the
 * whole point.
 *
 * `maxmem` has to be raised alongside N or Node refuses the parameters.
 */
const SCRYPT = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64, SCRYPT).toString("hex");
  return `scrypt2$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, salt, expected] = stored.split("$");
  if (!salt || !expected) return false;
  /*
   * Passwords hashed before the cost was raised still verify, at their original
   * parameters. The scheme is part of the stored value precisely so it can be
   * changed without locking anyone out; rehashing on next sign-in is the
   * natural follow-up and is noted in the launch checklist.
   */
  let derived: Buffer;
  if (scheme === "scrypt2") derived = scryptSync(password, salt, 64, SCRYPT);
  else if (scheme === "scrypt") derived = scryptSync(password, salt, 64);
  else return false;
  const expectedBuf = Buffer.from(expected, "hex");
  if (derived.length !== expectedBuf.length) return false;
  return timingSafeEqual(derived, expectedBuf);
}

/** True when a stored hash uses an older, cheaper scheme and should be upgraded. */
export function needsRehash(stored: string | null): boolean {
  return Boolean(stored) && !String(stored).startsWith("scrypt2$");
}

/* ---------------------------- db rows ----------------------------- */

export interface DbUser {
  id: string;
  org_id: string | null;
  facility_id: string | null;
  department_id: string | null;
  provider_id: string | null;
  name: string;
  email: string;
  phone: string;
  role: Role;
  password_hash: string | null;
  extra_perms: string;
  revoked_perms: string;
  status: "active" | "invited" | "suspended";
  /** Policy: an administrator requires a second factor from this account. */
  mfa_enabled: number;
  /** The shared TOTP secret, base32. Present but unconfirmed during enrolment. */
  mfa_secret: string | null;
  mfa_confirmed_at: string | null;
  /** scrypt hashes of the unused backup codes, JSON. Never the codes themselves. */
  mfa_backup_codes: string;
  /** The last TOTP time step spent, so a code cannot be replayed. */
  mfa_last_step: number;
  last_login: string | null;
  created_at: string;
}

export interface SessionUser {
  id: string;
  orgId: string | null;
  facilityId: string | null;
  departmentId: string | null;
  providerId: string | null;
  name: string;
  email: string;
  phone: string;
  role: Role;
  extraPermissions: Permission[];
  revokedPermissions: Permission[];
  status: "active" | "invited" | "suspended";
  /** Policy: an administrator requires a second factor from this account. */
  mfaEnabled: boolean;
  /** Fact: this account has an authenticator set up and proven. */
  mfaEnrolled: boolean;
  lastLogin: string | null;
  createdAt: string;
}

export function toSessionUser(u: DbUser): SessionUser {
  return {
    id: u.id,
    orgId: u.org_id,
    facilityId: u.facility_id,
    departmentId: u.department_id,
    providerId: u.provider_id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    extraPermissions: JSON.parse(u.extra_perms || "[]"),
    revokedPermissions: JSON.parse(u.revoked_perms || "[]"),
    status: u.status,
    mfaEnabled: Boolean(u.mfa_enabled),
    mfaEnrolled: Boolean(u.mfa_secret && u.mfa_confirmed_at),
    lastLogin: u.last_login,
    createdAt: u.created_at,
  };
}

/* ---------------------------- sessions ---------------------------- */

export function createSession(userId: string, orgId: string | null, ip = ""): string {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  run("INSERT INTO sessions (token, user_id, org_id, created_at, expires_at, ip) VALUES (?,?,?,?,?,?)", [
    token,
    userId,
    orgId,
    nowIso(),
    expires,
    ip,
  ]);
  run("UPDATE users SET last_login = ? WHERE id = ?", [nowIso(), userId]);
  return token;
}

export function destroySession(token: string) {
  run("DELETE FROM sessions WHERE token = ?", [token]);
}

/**
 * End every session this user holds.
 *
 * Called whenever the credential behind those sessions changes — a password
 * reset, a second factor added or removed. The point is the stolen-laptop case:
 * changing your password has to actually evict whoever made you change it,
 * otherwise the reset is theatre and the intruder keeps their cookie for a week.
 *
 * `except` keeps the session doing the changing alive, so a user who adds an
 * authenticator in Settings is not thrown out of the screen they are on.
 */
export function destroyUserSessions(userId: string, except?: string) {
  if (except) run("DELETE FROM sessions WHERE user_id = ? AND token <> ?", [userId, except]);
  else run("DELETE FROM sessions WHERE user_id = ?", [userId]);
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  /**
   * Mark the cookie secure only when the request actually arrived over https.
   * A production build served on plain http (a hospital's internal server, or
   * a local evaluation) would otherwise have its session cookie silently
   * dropped by the browser.
   */
  let secure = process.env.NODE_ENV === "production";
  try {
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? "";
    const host = h.get("host") ?? "";
    const local = host.startsWith("localhost") || host.startsWith("127.0.0.1");
    const https = proto.split(",")[0].trim() === "https";
    /*
     * Default to secure in production and only stand down for an explicit,
     * deliberate plain-HTTP deployment (a hospital's own internal server).
     *
     * The previous logic inferred it from `x-forwarded-proto`, which nginx does
     * not send unless someone remembers `proxy_set_header X-Forwarded-Proto
     * $scheme`. Forget that one line and a session cookie for a medical-records
     * system travels in clear text, with nothing on screen to say so.
     */
    if (https || local) secure = https && !local;
    if (process.env.ALLOW_INSECURE_COOKIES === "1") secure = false;
  } catch {
    /* keep the production default */
  }
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
    secure,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export interface Session {
  user: SessionUser;
  orgId: string | null;
  token: string;
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = get<{ user_id: string; org_id: string | null; expires_at: string }>(
    "SELECT user_id, org_id, expires_at FROM sessions WHERE token = ?",
    [token],
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    destroySession(token);
    return null;
  }
  const u = get<DbUser>("SELECT * FROM users WHERE id = ?", [row.user_id]);
  if (!u || u.status === "suspended") return null;
  return { user: toSessionUser(u), orgId: row.org_id ?? u.org_id, token };
}

export async function switchSessionOrg(token: string, orgId: string) {
  run("UPDATE sessions SET org_id = ? WHERE token = ?", [orgId, token]);
}

/* -------------------------- authorisation ------------------------- */

export function effective(user: SessionUser): Set<Permission> {
  const set = new Set<Permission>(ROLE_PERMISSIONS[user.role]);
  for (const p of user.extraPermissions) set.add(p);
  for (const p of user.revokedPermissions) set.delete(p);
  return set;
}

export function userCan(user: SessionUser, permission: Permission): boolean {
  return effective(user).has(permission);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Requires a signed-in user; returns the session or throws a 401. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new HttpError(401, "Not signed in");
  return s;
}

/**
 * Requires a signed-in user with a resolved tenant and, optionally, a
 * permission. This is the single choke point that makes cross-tenant access
 * impossible: every data route calls it and uses the org id it returns rather
 * than anything supplied by the client.
 */
export async function requireOrg(permission?: Permission): Promise<{ session: Session; orgId: string }> {
  const session = await requireSession();
  const orgId = session.orgId;
  if (!orgId) throw new HttpError(403, "No hospital selected for this session");
  if (session.user.role !== "super_admin" && session.user.orgId !== orgId) {
    throw new HttpError(403, "Cross-tenant access denied");
  }
  if (permission && !userCan(session.user, permission)) {
    throw new HttpError(403, `Missing permission: ${permission}`);
  }
  return { session, orgId };
}

/**
 * Like `requireOrg`, but satisfied by any one of several permissions.
 *
 * Some work is genuinely shared between roles that are otherwise separate. The
 * critical-results list is the clearest case: the clinician who acknowledges a
 * critical potassium needs it, and so does the laboratory technician whose job
 * is to telephone the ward about it — and they hold different permissions.
 * Requiring only the clinician's permission left the technician able to record
 * that they had notified the ward, but unable to see which results needed
 * notifying.
 *
 * This is still least privilege: it widens one endpoint to the roles that have
 * a real need, rather than granting anyone a permission they should not hold.
 */
export async function requireOrgAny(
  permissions: Permission[],
): Promise<{ session: Session; orgId: string }> {
  const session = await requireSession();
  const orgId = session.orgId;
  if (!orgId) throw new HttpError(403, "No hospital selected for this session");
  if (session.user.role !== "super_admin" && session.user.orgId !== orgId) {
    throw new HttpError(403, "Cross-tenant access denied");
  }
  if (permissions.length && !permissions.some((p) => userCan(session.user, p))) {
    throw new HttpError(403, `Missing permission: one of ${permissions.join(", ")}`);
  }
  return { session, orgId };
}

export function audit(session: Session, action: string, target = "", severity: "info" | "warning" | "critical" = "info") {
  writeAudit({
    orgId: session.orgId,
    actor: session.user.name,
    actorRole: session.user.role,
    action,
    target,
    severity,
  });
}

/* ------------------------- user management ------------------------ */

export function findUserByEmail(email: string, orgId?: string | null): DbUser | undefined {
  if (orgId === undefined) {
    return get<DbUser>("SELECT * FROM users WHERE lower(email) = lower(?) ORDER BY created_at LIMIT 1", [email]);
  }
  return get<DbUser>("SELECT * FROM users WHERE lower(email) = lower(?) AND IFNULL(org_id,'') = IFNULL(?,'')", [
    email,
    orgId,
  ]);
}

export function listUsersByEmail(email: string): DbUser[] {
  return all<DbUser>("SELECT * FROM users WHERE lower(email) = lower(?)", [email]);
}

export function createUser(input: {
  orgId: string | null;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  password?: string;
  facilityId?: string | null;
  departmentId?: string | null;
  providerId?: string | null;
  status?: "active" | "invited" | "suspended";
  mfaEnabled?: boolean;
}): DbUser {
  const userId = id("usr");
  run(
    `INSERT INTO users (id, org_id, facility_id, department_id, provider_id, name, email, phone, role,
        password_hash, extra_perms, revoked_perms, status, mfa_enabled, last_login, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      userId,
      input.orgId,
      input.facilityId ?? null,
      input.departmentId ?? null,
      input.providerId ?? null,
      input.name,
      input.email,
      input.phone ?? "",
      input.role,
      input.password ? hashPassword(input.password) : null,
      "[]",
      "[]",
      input.status ?? "active",
      input.mfaEnabled ? 1 : 0,
      null,
      nowIso(),
    ],
  );
  return get<DbUser>("SELECT * FROM users WHERE id = ?", [userId])!;
}
