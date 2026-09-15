import type { NextConfig } from "next";

/**
 * Response headers.
 *
 * None of these were set, which for an application serving medical records over
 * the public internet leaves several avoidable openings: the app can be framed
 * and clicked through by a hostile page, a single stripped TLS connection can
 * harvest a thirty-day session cookie, and URLs like /patients/pat_xxxx leak in
 * the Referer to every third-party asset the browser fetches.
 *
 * `frame-ancestors 'none'` and `X-Frame-Options: DENY` are both present on
 * purpose — the header is obsolete in modern browsers but still honoured by
 * older ones, which hospitals run.
 */
const isProd = process.env.NODE_ENV === "production";

/*
 * Content-Security-Policy is NOT set here. It needs a fresh nonce per request
 * so Next's inline hydration scripts can run while injected ones cannot, and a
 * static header cannot carry one — see src/middleware.ts.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  /* Same-origin only: a patient id in a URL must not travel to third parties. */
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

/* HSTS only in production: sending it from a local HTTP build would pin the
   developer's browser to https://localhost and break the next `npm run dev`. */
if (isProd) {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  });
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        /* Patient data must not sit in a shared cache or survive in bfcache. */
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, no-cache, must-revalidate, private" }],
      },
    ];
  },
};

export default nextConfig;
