/**
 * Stopping one person's edit from silently erasing another's.
 *
 * The failure this prevents: a receptionist opens a patient to correct the
 * phone number while a nurse opens the same patient to change the treating
 * doctor. Both press Save. Whoever saves second sends the whole form, including
 * the stale copy of the other person's field, and the first edit disappears
 * with no error, no trace on screen, and nothing to tell either of them. In a
 * hospital the erased field might be an allergy.
 *
 * The control is optimistic concurrency: a client sends the version it was
 * looking at, and a write against a stale version is refused.
 *
 * But a blunt version check is its own problem — it would refuse the phone-number
 * edit above even though the two people touched different fields, and staff who
 * are refused for no visible reason learn to retry blindly, which is worse than
 * no check at all. So this compares *fields*: a write is refused only when
 * something it is trying to change has itself changed since the client read it.
 * Edits that do not overlap are allowed, and the user is never interrupted
 * without cause.
 */

import { all } from "./db";
import { HttpError } from "./auth";

export interface ConflictField {
  field: string;
  /** What the value was when the client read the record. */
  mine: unknown;
  /** What it is now. */
  theirs: unknown;
  changedBy: string;
  changedAt: string;
}

export class ConflictError extends HttpError {
  readonly conflicts: ConflictField[];
  readonly currentVersion: number;
  constructor(message: string, conflicts: ConflictField[], currentVersion: number) {
    super(409, message);
    this.name = "ConflictError";
    this.conflicts = conflicts;
    this.currentVersion = currentVersion;
  }
}

/**
 * Everything that changed on one record since a given version, newest last.
 *
 * Reconstructed from the clinical audit trail, which already records the
 * before/after of every field that changed. That means the conflict report is
 * derived from the same evidence the hospital would use to investigate one, and
 * cannot drift from it.
 */
function changesSince(orgId: string, entityId: string, sinceVersion: number) {
  return all<{ after: string | null; before: string | null; actor_name: string; at: string; entity_version: number | null }>(
    `SELECT after, before, actor_name, at, entity_version
       FROM clinical_audit
      WHERE org_id = ? AND entity_id = ?
        AND entity_version IS NOT NULL AND entity_version > ?
      ORDER BY entity_version ASC`,
    [orgId, entityId, sinceVersion],
  );
}

/**
 * Refuse a write that would overwrite someone else's change.
 *
 * @param expectedVersion the version the client was looking at; when omitted the
 *   check is skipped, which is the right behaviour for callers that legitimately
 *   write blind (imports, the voice agent updating a last-contact timestamp).
 * @param currentVersion  the version in the database now
 * @param incomingFields  the fields this write intends to change
 */
export function assertNoConflict(opts: {
  orgId: string;
  entityId: string;
  entityLabel: string;
  expectedVersion?: number | null;
  currentVersion: number;
  incomingFields: string[];
}): void {
  const { orgId, entityId, entityLabel, expectedVersion, currentVersion, incomingFields } = opts;

  if (expectedVersion === undefined || expectedVersion === null) return;
  if (expectedVersion === currentVersion) return;

  if (expectedVersion > currentVersion) {
    /* The client claims to have seen a version that does not exist. Almost
       always a client bug, but never something to write through. */
    throw new ConflictError(
      `This ${entityLabel} could not be saved: the version you are editing (v${expectedVersion}) is newer than the one on record (v${currentVersion}). Reload and try again.`,
      [],
      currentVersion,
    );
  }

  const wanted = new Set(incomingFields);
  const conflicts = new Map<string, ConflictField>();

  for (const row of changesSince(orgId, entityId, expectedVersion)) {
    let before: Record<string, unknown> = {};
    let after: Record<string, unknown> = {};
    try {
      before = row.before ? (JSON.parse(row.before) as Record<string, unknown>) : {};
      after = row.after ? (JSON.parse(row.after) as Record<string, unknown>) : {};
    } catch {
      continue;
    }
    for (const field of Object.keys(after)) {
      if (!wanted.has(field)) continue;
      /* Keep the earliest "mine" and the latest "theirs" across several edits. */
      const existing = conflicts.get(field);
      conflicts.set(field, {
        field,
        mine: existing ? existing.mine : before[field],
        theirs: after[field],
        changedBy: row.actor_name || "another user",
        changedAt: row.at,
      });
    }
  }

  if (!conflicts.size) return; /* they edited different things — no real conflict */

  const list = [...conflicts.values()];
  const names = list.map((c) => c.field).join(", ");
  const who = list[0].changedBy;
  throw new ConflictError(
    `${who} changed ${names} on this ${entityLabel} while you were editing. Your change was not saved, so nothing has been lost — review the differences and save again.`,
    list,
    currentVersion,
  );
}

/** The version a caller supplied, if it supplied a usable one. */
export function readExpectedVersion(patch: Record<string, unknown>): number | null {
  const raw = patch.expectedVersion ?? patch.version;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
