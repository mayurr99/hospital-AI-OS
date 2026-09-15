import { NextResponse } from "next/server";
import { body, handler } from "@/lib/server/route";
import { assertStrongPassword } from "@/lib/server/password-policy";
import { HttpError, createSession, findUserByEmail, setSessionCookie } from "@/lib/server/auth";
import { createTenant } from "@/lib/server/provision";
import { writeAudit } from "@/lib/server/db";
import { callerIp, hit, SIGNUP_PER_IP } from "@/lib/server/ratelimit";

interface SignupBody {
  hospitalName: string;
  adminName: string;
  email: string;
  password: string;
  phone?: string;
  city?: string;
  acceptedTerms?: boolean;
}

export async function POST(req: Request) {
  return handler(async () => {
    const b = await body<SignupBody>(req);

    /* Signup creates a tenant and seeds it. Unmetered, that is both a spam
       vector and a way to fill the disk. */
    const gate = hit(`signup:ip:${callerIp(req)}`, SIGNUP_PER_IP);
    if (!gate.allowed) {
      return NextResponse.json(
        { error: "Too many workspaces created from this connection. Try again later." },
        { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
      );
    }

    if (!b.hospitalName?.trim()) throw new HttpError(400, "Hospital name is required");
    if (!b.adminName?.trim()) throw new HttpError(400, "Your name is required");
    if (!b.email?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) throw new HttpError(400, "A valid work email is required");
    /* The same rule every other door uses — see password-policy.ts. */
    assertStrongPassword(b.password);
    if (findUserByEmail(b.email.trim())) throw new HttpError(409, "An account already exists for this email");

    const { orgId, admin, trialEnds } = createTenant({
      hospitalName: b.hospitalName.trim(),
      adminName: b.adminName.trim(),
      email: b.email.trim().toLowerCase(),
      password: b.password,
      phone: b.phone,
      city: b.city,
    });

    writeAudit({
      orgId,
      actor: admin.name,
      actorRole: "hospital_admin",
      action: "tenant.created",
      target: `${b.hospitalName} — 7-day trial until ${trialEnds.slice(0, 10)}`,
      severity: "critical",
    });

    const token = createSession(admin.id, orgId);
    await setSessionCookie(token);

    return NextResponse.json({ ok: true, orgId, trialEnds, next: "/onboarding" });
  });
}
