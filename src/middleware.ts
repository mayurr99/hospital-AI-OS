import { NextResponse, type NextRequest } from "next/server";

/**
 * Content Security Policy.
 *
 * Two stricter versions of this were tried and measured before settling here,
 * and the reasoning matters more than the header:
 *
 *  1. `script-src 'self'` — took the whole product down. Next.js hydrates
 *     through inline bootstrap scripts; banning inline script means the server
 *     HTML arrives and nothing works. The sign-up form rendered zero inputs.
 *
 *  2. `script-src 'nonce-…' 'strict-dynamic'` — the textbook answer, and it
 *     fixed the inline scripts, but `strict-dynamic` makes a browser ignore
 *     `'self'`, and Next only stamps its nonce onto scripts for *dynamically*
 *     rendered routes. This application's pages are statically prerendered, so
 *     every chunk file was refused instead. Adopting it properly means forcing
 *     every route dynamic and giving up static rendering across the product.
 *
 * So this ships `'unsafe-inline'` for scripts, deliberately and with its cost
 * stated plainly: it does **not** stop an injected inline script. What it does
 * still buy is real — no script may be loaded from another origin, no page may
 * frame this one, no form may post off-site, and `connect-src 'self'` means an
 * injection cannot exfiltrate a patient list to an attacker's server, which is
 * the step that turns a bug into a breach.
 *
 * The route to a genuinely strict policy is in the launch checklist: render the
 * workspace routes dynamically and move to the nonce. It is a real improvement
 * and it is not a five-minute one.
 */
export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV !== "production";

  const csp = [
    "default-src 'self'",
    /* Dev additionally needs 'unsafe-eval' for fast refresh; production does not. */
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    /* Tailwind injects styles at runtime; there is no nonce path for it, and an
       inline style cannot exfiltrate data the way an inline script can. */
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    /* The browser talks only to this origin. Voice and storage providers are
       called from the server, never from the page. */
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  /* Next reads the nonce from the request headers and applies it to its scripts. */
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own static output and image optimiser — those
     * are files, not documents, and a policy header on them is wasted bytes on
     * every asset.
     */
    { source: "/((?!_next/static|_next/image|favicon.ico).*)" },
  ],
};
