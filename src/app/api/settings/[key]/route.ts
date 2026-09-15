import { redactSecrets } from "@/lib/server/secrets";
import { body, handler } from "@/lib/server/route";
import { HttpError, audit, requireOrg } from "@/lib/server/auth";
import { settings } from "@/lib/server/db";
import { DEFAULT_ESCALATION, DEFAULT_STORAGE, DEFAULT_VOICE } from "@/lib/server/provision";
import type { Permission } from "@/lib/types";

const ALLOWED: Record<string, { permission: Permission; fallback: unknown }> = {
  storage: { permission: "org.configure", fallback: DEFAULT_STORAGE },
  voice: { permission: "agents.configure", fallback: DEFAULT_VOICE },
  escalation: { permission: "protocols.configure", fallback: DEFAULT_ESCALATION },
  telephony: { permission: "telephony.configure", fallback: null },
  knowledge: { permission: "agents.configure", fallback: [] },
};

/** A masked value coming back from the browser means "leave the stored secret alone". */
function mergeSecrets(key: string, incoming: unknown, current: unknown) {
  if (key !== "voice" && key !== "storage") return incoming;
  const next = JSON.parse(JSON.stringify(incoming)) as Record<string, Record<string, unknown>>;
  const prev = (current ?? {}) as Record<string, Record<string, unknown>>;
  const keep = (section: string, field: string) => {
    if (next[section] && next[section][field] === "••••••••") next[section][field] = prev[section]?.[field] ?? "";
  };
  if (key === "voice") { keep("retell", "apiKey"); keep("retell", "webhookSecret"); keep("elevenlabs", "apiKey"); }
  if (key === "storage") keep("s3", "secretAccessKey");
  return next;
}

/**
 * Fill a stored settings blob out to the shape the app expects.
 *
 * Settings are JSON documents that outlive the code that wrote them. A tenant
 * configured before a field existed has a blob without it, and a screen reading
 * `cfg.elevenlabs.stability.toFixed(2)` on such a blob does not degrade — it
 * throws, and React replaces the entire page with "Application error". A
 * hospital then cannot reach its voice settings at all, with nothing on screen
 * explaining why.
 *
 * Merging over the defaults on read costs nothing and makes a missing field a
 * non-event. It is one level deep plus the known nested sections, which is the
 * shape these documents actually have.
 */
function withDefaults(fallback: unknown, stored: unknown): unknown {
  if (!fallback || typeof fallback !== "object" || Array.isArray(fallback)) return stored ?? fallback;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return fallback;
  const base = fallback as Record<string, unknown>;
  const over = stored as Record<string, unknown>;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = base[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) && v && typeof v === "object" && !Array.isArray(v)
      ? { ...(b as Record<string, unknown>), ...(v as Record<string, unknown>) }
      : v;
  }
  return out;
}

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  return handler(async () => {
    const { key } = await ctx.params;
    const spec = ALLOWED[key];
    if (!spec) throw new HttpError(404, "Unknown setting");
    const { orgId } = await requireOrg(spec.permission);
    const stored = settings.get(orgId, key, spec.fallback);
    return { key, value: redactSecrets(key, withDefaults(spec.fallback, stored)) };
  });
}

export async function PUT(req: Request, ctx: { params: Promise<{ key: string }> }) {
  return handler(async () => {
    const { key } = await ctx.params;
    const spec = ALLOWED[key];
    if (!spec) throw new HttpError(404, "Unknown setting");
    const { session, orgId } = await requireOrg(spec.permission);
    const b = await body<{ value: unknown }>(req);

    /*
     * Check the shape before touching anything.
     *
     * This endpoint takes `{ value: { ... } }`. A body without it — a client
     * sending the settings object directly, which is the obvious mistake — used
     * to reach `JSON.stringify(undefined)` and come back as a 500 with
     * `"undefined" is not valid JSON`, or a SQLite binding error. A 500 is the
     * server saying it does not know what happened; for a wrong-shaped request
     * it does know, and should say so. Unhandled exceptions are also exactly
     * what somebody probing an API goes looking for.
     */
    if (b.value === undefined || b.value === null || typeof b.value !== "object" || Array.isArray(b.value)) {
      throw new HttpError(422, `Send the settings as { "value": { ... } } — received ${Array.isArray(b.value) ? "an array" : typeof b.value}`);
    }

    const current = settings.get(orgId, key, spec.fallback);
    const merged = mergeSecrets(key, b.value, current);
    settings.set(orgId, key, merged);
    audit(session, `settings.${key}.updated`, JSON.stringify(redactSecrets(key, merged)).slice(0, 180), "warning");
    return { ok: true, key, value: redactSecrets(key, merged) };
  });
}
