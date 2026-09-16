import { NextResponse } from "next/server";
import { HttpError } from "./auth";
import { ConflictError } from "./concurrency";
import { ensureSeeded } from "./provision";
import { StorageUnwritableError } from "./db";
import { backfillAll } from "./backfill";

let seeded = false;

/** Every route handler goes through this: seeds demo tenants once, maps errors. */
export function handler<T>(fn: () => Promise<T>) {
  return (async () => {
    try {
      if (!seeded) {
        ensureSeeded();
        // Reshape any legacy JSON records into the relational clinical core.
        backfillAll();
        seeded = true;
      }
      const data = await fn();
      if (data instanceof NextResponse) return data;
      return NextResponse.json(data ?? { ok: true });
    } catch (e) {
      /*
       * A concurrent-edit conflict carries the fields that clash and who
       * changed them. The client needs that detail to show a merge, so it
       * travels with the error rather than being flattened into a message.
       */
      if (e instanceof ConflictError) {
        return NextResponse.json(
          { error: e.message, conflict: true, conflicts: e.conflicts, currentVersion: e.currentVersion },
          { status: 409 },
        );
      }
      if (e instanceof HttpError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      /*
       * The deployment cannot write to its database. 503, because the service
       * genuinely is unavailable rather than the request being wrong — and the
       * message is the one a person can act on, not the driver's.
       */
      if (e instanceof StorageUnwritableError) {
        console.error("[storage]", e.message, "—", e.detail);
        return NextResponse.json({ error: e.message }, { status: 503 });
      }
      /*
       * Defence in depth: if the same condition surfaces from a driver call
       * that did not pass through the startup probe, it must still not reach a
       * user as raw SQLite text.
       */
      if (e instanceof Error && /readonly database|attempt to write a readonly|unable to open database file/i.test(e.message)) {
        console.error("[storage]", e.message);
        return NextResponse.json({ error: new StorageUnwritableError(e.message).message }, { status: 503 });
      }
      const message = e instanceof Error ? e.message : "Unexpected error";
      console.error("[api]", message);
      /* Unknown failures stay in the server log. Returning the raw exception
         can disclose SQL, file paths, provider responses or implementation
         details to the person probing the endpoint. */
      return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
    }
  })();
}

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}
