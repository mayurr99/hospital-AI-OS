import { handler } from "@/lib/server/route";
import { requireOrg, type DbUser } from "@/lib/server/auth";
import { all } from "@/lib/server/db";
import { hasDemoOrgs, isEnrolled, mfaRequired, securityFor } from "@/lib/server/mfa";
import { toSessionUser } from "@/lib/server/auth";
import { keyStatus } from "@/lib/server/encryption";

/**
 * What the security controls on this deployment actually amount to.
 *
 * Written so an administrator — or an auditor standing behind them — can see
 * the difference between what is configured and what is in force, without
 * taking anyone's word for it. It reports the exemptions too: a page that
 * listed only the protections would be the same kind of half-truth as an
 * "MFA enabled" switch nothing reads.
 */
export async function GET() {
  return handler(async () => {
    const { orgId } = await requireOrg("org.configure");
    const staff = all<DbUser>("SELECT * FROM users WHERE org_id = ? AND status <> 'suspended'", [orgId]);

    let required = 0;
    let enrolled = 0;
    let pending = 0;
    for (const u of staff) {
      const isReq = mfaRequired(toSessionUser(u));
      const isEnr = isEnrolled(u);
      if (isReq) required++;
      if (isEnr) enrolled++;
      if (isReq && !isEnr) pending++;
    }

    const key = keyStatus();
    const demoData = hasDemoOrgs();

    return {
      ok: true,
      mfa: {
        staff: staff.length,
        required,
        enrolled,
        pending,
        requireAllStaff: securityFor(orgId).requireMfaForAllStaff,
        /* Both ways this deployment can fall below the floor, named plainly. */
        floorDisabled: process.env.MFA_FLOOR === "off",
        demoDataPresent: demoData,
      },
      encryptionAtRest: {
        configured: key.configured,
        fingerprint: key.fingerprint,
        detail: key.detail,
        /* Stated every time, because it is the limit people assume away. */
        covers: "Recordings and export bundles only. The database file itself is not encrypted by the application.",
      },
    };
  });
}
