/**
 * Safe JSON reader for every browser → API call.
 *
 * If the server ever answers with an HTML page (a 404 page, a Next.js error
 * overlay, a proxy or tunnel interstitial), `res.json()` throws the unhelpful
 * "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON". This turns that
 * into a message that says what actually went wrong and what to do about it.
 */
export async function readJson<T = Record<string, unknown>>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    const html = text.trimStart().toLowerCase().startsWith("<");
    if (!html) throw new Error(`The server sent a reply the app could not read (HTTP ${res.status}).`);
    if (res.status === 404) {
      throw new Error(
        "The API route was not found — the server sent a web page instead of data. " +
          "Make sure the app is started from the project folder (npm run dev, or npm run build && npm start) " +
          "and that you are on the same port the terminal printed.",
      );
    }
    throw new Error(
      `The server returned an error page instead of data (HTTP ${res.status}). ` +
        "Check the terminal running the app for the real error — the most common cause is running " +
        "Node older than 22.5, which has no built-in SQLite.",
    );
  }
}

/** One field two people changed at once. */
export interface ConflictField {
  field: string;
  mine: unknown;
  theirs: unknown;
  changedBy: string;
  changedAt: string;
}

/**
 * A save refused because someone else changed the same fields first.
 *
 * Carries the detail rather than only a message, because the point of refusing
 * the save is to let the user see both values and decide — a bare "could not
 * save" would just teach them to press the button again.
 */
export class ApiConflictError extends Error {
  readonly conflicts: ConflictField[];
  readonly currentVersion: number;
  constructor(message: string, conflicts: ConflictField[], currentVersion: number) {
    super(message);
    this.name = "ApiConflictError";
    this.conflicts = conflicts;
    this.currentVersion = currentVersion;
  }
}

/** fetch + readJson + error propagation in one call. */
export async function api<T = Record<string, unknown>>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const data = await readJson<T & {
    error?: string; conflict?: boolean; conflicts?: ConflictField[]; currentVersion?: number;
  }>(res);
  if (!res.ok) {
    if (res.status === 409 && data.conflict) {
      throw new ApiConflictError(
        data.error ?? "Someone else changed this first",
        data.conflicts ?? [],
        data.currentVersion ?? 0,
      );
    }
    throw new Error(data.error ?? `Request failed (HTTP ${res.status})`);
  }
  return data;
}
