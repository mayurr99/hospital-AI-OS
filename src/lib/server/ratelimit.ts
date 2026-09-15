/**
 * Rate limiting for the endpoints an attacker gets to call without an account.
 *
 * Without this, sign-in is an unlimited, unmetered oracle: an attacker can try
 * every password in a breach list against every email they can guess, as fast as
 * the server will answer. In a hospital that ends with somebody else's medical
 * records.
 *
 * There is a second reason, less obvious and just as serious. Password
 * verification is deliberately expensive — that is the whole point of scrypt —
 * and the application runs on one event loop. A few hundred concurrent sign-in
 * attempts therefore do not merely fail, they stall the entire hospital's
 * software: the ward board stops, the laboratory stops, admissions stop. A
 * login storm must be cheap to refuse.
 *
 * Two keys are counted independently, because they defend different things:
 *
 *   - by **account**, so one user's password cannot be ground down however many
 *     addresses the attacker comes from;
 *   - by **source address**, so one machine cannot spray attempts across many
 *     accounts.
 *
 * This is in-process, which matches the single-node deployment this ships as.
 * Running several nodes means moving the counters to Redis; the call sites do
 * not change, because none of them knows where the count lives.
 */

interface Bucket {
  /** Attempt timestamps inside the window, oldest first. */
  hits: number[];
  /** Set when the bucket is locked out; nothing is counted until it passes. */
  blockedUntil: number;
}

const buckets = new Map<string, Bucket>();

/** Drop buckets nobody has touched, so a long-running server does not grow. */
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    const idle = !b.hits.length || now - b.hits[b.hits.length - 1] > 3_600_000;
    if (idle && b.blockedUntil < now) buckets.delete(key);
  }
}

export interface LimitResult {
  allowed: boolean;
  /** Seconds until the caller may try again. Only meaningful when blocked. */
  retryAfter: number;
  remaining: number;
}

export interface LimitRule {
  /** How many attempts are allowed inside the window. */
  limit: number;
  /** The rolling window, in milliseconds. */
  windowMs: number;
  /** How long to lock out after the limit is exceeded. */
  blockMs: number;
}

/**
 * Limits are deployment-configurable, because the right number genuinely
 * differs: a single hospital behind one NAT address needs a far higher
 * per-address allowance than a public sign-up page, and a hospital group
 * onboarding twelve branches in an afternoon is not abuse.
 *
 * The defaults are the safe ones. Raising them is a deliberate act with an
 * obvious name in the environment, not something that happens by accident.
 */
const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const LOGIN_PER_ACCOUNT: LimitRule = {
  limit: envInt("RATE_LIMIT_LOGIN_PER_ACCOUNT", 8), windowMs: 15 * 60_000, blockMs: 15 * 60_000,
};
export const LOGIN_PER_IP: LimitRule = {
  limit: envInt("RATE_LIMIT_LOGIN_PER_IP", 30), windowMs: 15 * 60_000, blockMs: 15 * 60_000,
};
export const SIGNUP_PER_IP: LimitRule = {
  limit: envInt("RATE_LIMIT_SIGNUP_PER_IP", 5), windowMs: 60 * 60_000, blockMs: 60 * 60_000,
};
export const WEBHOOK_PER_IP: LimitRule = {
  limit: envInt("RATE_LIMIT_WEBHOOK_PER_IP", 120), windowMs: 60_000, blockMs: 5 * 60_000,
};

/**
 * Count one attempt against a key.
 *
 * Call it *before* doing the expensive work, so a refused attempt costs a map
 * lookup rather than a key-derivation.
 */
export function hit(key: string, rule: LimitRule): LimitResult {
  const now = Date.now();
  sweep(now);

  const b = buckets.get(key) ?? { hits: [], blockedUntil: 0 };
  buckets.set(key, b);

  if (b.blockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((b.blockedUntil - now) / 1000), remaining: 0 };
  }

  const cutoff = now - rule.windowMs;
  b.hits = b.hits.filter((t) => t > cutoff);

  if (b.hits.length >= rule.limit) {
    b.blockedUntil = now + rule.blockMs;
    b.hits = [];
    return { allowed: false, retryAfter: Math.ceil(rule.blockMs / 1000), remaining: 0 };
  }

  b.hits.push(now);
  return { allowed: true, retryAfter: 0, remaining: rule.limit - b.hits.length };
}

/** Forget a key's attempts — called after a successful sign-in. */
export function clear(key: string) {
  buckets.delete(key);
}

/**
 * The caller's address, as best the deployment can tell.
 *
 * Behind a proxy this is only as trustworthy as the proxy: `x-forwarded-for` is
 * attacker-controlled unless something in front overwrites it. The per-account
 * limit is therefore the one that must hold on its own, and this is the
 * secondary defence rather than the primary one.
 */
export function callerIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
