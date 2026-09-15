import { NextResponse } from "next/server";
import { health } from "@/lib/server/health";

/**
 * GET /api/health — for an uptime monitor, and for whoever is on call.
 *
 * Unauthenticated on purpose: a monitor that has to hold a hospital's
 * credentials is a worse problem than the one it solves, and a check that
 * cannot run when authentication is broken is not a health check.
 *
 * What that buys has to be paid for in restraint. The response names no
 * hospital, counts no patients and quotes no error text that could describe the
 * deployment — a public health endpoint is otherwise free reconnaissance.
 *
 * The status code is the part a monitor actually reads:
 *   200  serving normally
 *   200  degraded — still serving; something needs attention today, not now
 *   503  failing  — page someone
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const report = health();

  /*
   * `?brief=1` answers with nothing but the word, for monitors that only match
   * on body text and for anyone who would rather not expose even this much.
   */
  if (new URL(req.url).searchParams.get("brief") === "1") {
    return new NextResponse(report.status, {
      status: report.status === "failing" ? 503 : 200,
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json(report, {
    status: report.status === "failing" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
