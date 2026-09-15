/**
 * Encryption for files written to local disk.
 *
 * The product had an "Encrypt at rest" switch in Settings that defaulted to on
 * and that no code read. Call recordings and export bundles — audio of patients
 * describing their symptoms, and CSVs of their records — were written in plain
 * text while the hospital believed otherwise. A compliance control that does
 * nothing is worse than not offering one, because someone signs a form on the
 * strength of it.
 *
 * What this covers, and what it does not, stated plainly because the difference
 * is the whole point:
 *
 *   **Covered.** Recordings and export bundles written by the local storage
 *   driver. AES-256-GCM, a fresh random IV per object, and an authentication tag
 *   — so a file that has been altered on disk fails to decrypt rather than
 *   returning quietly corrupted audio.
 *
 *   **Not covered.** The SQLite database itself. Encrypting that needs SQLCipher
 *   or an encrypted filesystem; it cannot be done from application code, and
 *   pretending otherwise would repeat the mistake this module exists to correct.
 *   The Settings screen and the system status page both say so.
 *
 * The key lives in the environment, never in the database — a key stored beside
 * the data it protects protects nothing. Without `STORAGE_ENCRYPTION_KEY` the
 * driver writes in the clear and says so everywhere it is asked, rather than
 * silently claiming a protection it does not have.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/** Magic bytes so an encrypted object is recognisable, and old plaintext still readable. */
const MAGIC = Buffer.from("HAOS1:", "utf8");
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface KeyStatus {
  configured: boolean;
  /** A short fingerprint so two deployments can be compared without revealing the key. */
  fingerprint: string;
  detail: string;
}

let cached: Buffer | null | undefined;

/**
 * The key, if one is configured.
 *
 * Accepts 64 hex characters or 32 bytes of base64. A short or malformed value is
 * refused rather than stretched into something that looks like a key — quietly
 * accepting a weak one is how this kind of control fails in practice.
 */
export function encryptionKey(): Buffer | null {
  if (cached !== undefined) return cached;
  const raw = (process.env.STORAGE_ENCRYPTION_KEY ?? "").trim();
  if (!raw) return (cached = null);

  let key: Buffer | null = null;
  if (/^[0-9a-f]{64}$/i.test(raw)) key = Buffer.from(raw, "hex");
  else {
    try {
      const b = Buffer.from(raw, "base64");
      if (b.length === 32) key = b;
    } catch {
      key = null;
    }
  }
  if (!key) {
    /* Loud, once, at startup rather than a silent fallback to plaintext. */
    console.error(
      "[storage] STORAGE_ENCRYPTION_KEY is set but is not a 32-byte key " +
        "(64 hex characters, or 32 bytes base64). Files will be written unencrypted. " +
        "Generate one with: openssl rand -hex 32",
    );
    return (cached = null);
  }
  return (cached = key);
}

export function keyStatus(): KeyStatus {
  const key = encryptionKey();
  if (!key) {
    return {
      configured: false,
      fingerprint: "",
      detail: "No STORAGE_ENCRYPTION_KEY is set — files are written unencrypted.",
    };
  }
  return {
    configured: true,
    fingerprint: createHash("sha256").update(key).digest("hex").slice(0, 8),
    detail: "Recordings and export bundles are encrypted with AES-256-GCM before they touch the disk.",
  };
}

/** Encrypt if a key is configured; otherwise return the body unchanged. */
export function encryptBuffer(body: Buffer): Buffer {
  const key = encryptionKey();
  if (!key) return body;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const sealed = Buffer.concat([cipher.update(body), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), sealed]);
}

/**
 * Decrypt an object written by `encryptBuffer`.
 *
 * Plaintext written before a key was configured is returned as-is, so turning
 * encryption on does not orphan a hospital's existing recordings. The reverse —
 * an encrypted file with no key — throws, because handing back ciphertext
 * labelled as audio would be worse than an error.
 */
export function decryptBuffer(stored: Buffer): Buffer {
  if (stored.length < MAGIC.length || !stored.subarray(0, MAGIC.length).equals(MAGIC)) {
    return stored; /* written before encryption was enabled */
  }
  const key = encryptionKey();
  if (!key) {
    throw new Error(
      "This file is encrypted but STORAGE_ENCRYPTION_KEY is not set. " +
        "Restore the key used when it was written — without it the file cannot be recovered.",
    );
  }
  const iv = stored.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = stored.subarray(MAGIC.length + IV_BYTES, MAGIC.length + IV_BYTES + TAG_BYTES);
  const body = stored.subarray(MAGIC.length + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/** True when the bytes on disk are an encrypted object rather than plaintext. */
export function isEncrypted(stored: Buffer): boolean {
  return stored.length >= MAGIC.length && stored.subarray(0, MAGIC.length).equals(MAGIC);
}
