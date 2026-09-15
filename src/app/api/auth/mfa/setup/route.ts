import QRCode from "qrcode";
import { body, handler } from "@/lib/server/route";
import { toSessionUser } from "@/lib/server/auth";
import { get } from "@/lib/server/db";
import { beginEnrolment, enrolmentActor, mfaRequired } from "@/lib/server/mfa";
import { generateSecret, otpauthUri } from "@/lib/server/totp";

interface SetupBody { challenge?: string }

/**
 * Start enrolment: mint a secret and hand back what an authenticator needs.
 *
 * The QR is returned as a matrix of black-and-white modules rather than an
 * image. The page draws it as an SVG from that matrix, so nothing is rendered
 * from an HTML string, no image is fetched from anywhere, and the content
 * security policy does not have to be loosened for a picture of a secret.
 *
 * The secret is also returned in text, because a hospital machine without a
 * camera in front of it is a normal situation and typing the key in is the
 * documented fallback for every authenticator app.
 */
export async function POST(req: Request) {
  return handler(async () => {
    const b = await body<SetupBody>(req).catch(() => ({}) as SetupBody);
    const { user } = await enrolmentActor(b.challenge);

    const secret = generateSecret();
    beginEnrolment(user.id, secret);

    const org = user.org_id
      ? get<{ name: string }>("SELECT name FROM organizations WHERE id = ?", [user.org_id])
      : undefined;
    const issuer = org?.name ?? "Hospital AI OS";
    const uri = otpauthUri(secret, user.email, issuer);

    const qr = QRCode.create(uri, { errorCorrectionLevel: "M" });
    const size = qr.modules.size;
    const data = qr.modules.data;
    /* One boolean per module, row-major — small enough to send as JSON. */
    const modules: boolean[] = Array.from({ length: size * size }, (_, i) => Boolean(data[i]));

    return {
      ok: true,
      secret,
      uri,
      issuer,
      account: user.email,
      qr: { size, modules },
      required: mfaRequired(toSessionUser(user)),
    };
  });
}
