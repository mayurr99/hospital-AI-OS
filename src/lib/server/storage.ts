import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, settings } from "./db";
import { DEFAULT_STORAGE, type StorageConfig } from "./provision";
import { decryptBuffer, encryptBuffer, encryptionKey, isEncrypted } from "./encryption";

/**
 * Pluggable object storage. Every hospital chooses where its call recordings
 * and export bundles live — a local encrypted volume on their own server, or
 * any S3-compatible bucket (AWS, MinIO, Cloudflare R2, Wasabi).
 */

export interface StoredObject {
  key: string;
  bytes: number;
  mime: string;
}

export interface StorageDriver {
  kind: "local" | "s3";
  put(key: string, body: Buffer, mime: string): Promise<StoredObject>;
  get(key: string): Promise<{ body: Buffer; mime: string } | null>;
  remove(key: string): Promise<void>;
  test(): Promise<{ ok: boolean; detail: string }>;
  describe(): string;
}

/* ------------------------------- local ---------------------------- */

class LocalDriver implements StorageDriver {
  kind = "local" as const;
  constructor(private root: string) {}

  private resolve(key: string) {
    const safe = key.replace(/\.\./g, "").replace(/^\/+/, "");
    return path.join(this.root, safe);
  }

  async put(key: string, body: Buffer, mime: string) {
    const file = this.resolve(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    /* Encrypted before it touches the disk when a key is configured — see
       encryption.ts. The recorded byte count is the original length, because
       that is what the hospital is being told about the recording, not the
       overhead of the envelope. */
    fs.writeFileSync(file, encryptBuffer(body));
    fs.writeFileSync(
      `${file}.meta.json`,
      JSON.stringify({ mime, bytes: body.length, encrypted: Boolean(encryptionKey()) }),
    );
    return { key, bytes: body.length, mime };
  }

  async get(key: string) {
    const file = this.resolve(key);
    if (!fs.existsSync(file)) return null;
    let mime = "application/octet-stream";
    try {
      mime = JSON.parse(fs.readFileSync(`${file}.meta.json`, "utf8")).mime ?? mime;
    } catch {
      /* no sidecar */
    }
    const stored = fs.readFileSync(file);
    /* Plaintext written before encryption was turned on still reads back; an
       encrypted file with no key throws rather than returning ciphertext
       labelled as audio. */
    return { body: decryptBuffer(stored), mime };
  }

  /** Whether the bytes on disk for this key are encrypted. Used by diagnostics. */
  isObjectEncrypted(key: string): boolean {
    const file = this.resolve(key);
    if (!fs.existsSync(file)) return false;
    /* Only the magic prefix is needed, so this does not read a whole recording. */
    const fd = fs.openSync(file, "r");
    try {
      const head = Buffer.alloc(6);
      fs.readSync(fd, head, 0, 6, 0);
      return isEncrypted(head);
    } finally {
      fs.closeSync(fd);
    }
  }

  async remove(key: string) {
    const file = this.resolve(key);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    if (fs.existsSync(`${file}.meta.json`)) fs.unlinkSync(`${file}.meta.json`);
  }

  async test() {
    try {
      const probe = `._healthcheck/${Date.now()}.txt`;
      await this.put(probe, Buffer.from("ok"), "text/plain");
      const back = await this.get(probe);
      await this.remove(probe);
      const ok = back?.body.toString() === "ok";
      return { ok, detail: ok ? `Read/write verified at ${this.root}` : "Write succeeded but read-back failed" };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : "Unknown error" };
    }
  }

  describe() {
    return `Local volume · ${this.root}`;
  }
}

/* --------------------------------- s3 ----------------------------- */

class S3Driver implements StorageDriver {
  kind = "s3" as const;
  constructor(private cfg: StorageConfig["s3"]) {}

  private async client() {
    const { S3Client } = await import("@aws-sdk/client-s3");
    return new S3Client({
      region: this.cfg.region || "ap-south-1",
      endpoint: this.cfg.endpoint || undefined,
      forcePathStyle: this.cfg.forcePathStyle || Boolean(this.cfg.endpoint),
      credentials:
        this.cfg.accessKeyId && this.cfg.secretAccessKey
          ? { accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey }
          : undefined,
    });
  }

  async put(key: string, body: Buffer, mime: string) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const c = await this.client();
    await c.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: mime, ServerSideEncryption: "AES256" }));
    return { key, bytes: body.length, mime };
  }

  async get(key: string) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const c = await this.client();
    try {
      const res = await c.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      const chunks: Buffer[] = [];
      const stream = res.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return { body: Buffer.concat(chunks), mime: res.ContentType ?? "application/octet-stream" };
    } catch {
      return null;
    }
  }

  async remove(key: string) {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const c = await this.client();
    await c.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  async test() {
    if (!this.cfg.bucket) return { ok: false, detail: "No bucket configured" };
    if (!this.cfg.accessKeyId || !this.cfg.secretAccessKey) return { ok: false, detail: "Access key and secret are required" };
    try {
      const probe = `._healthcheck/${Date.now()}.txt`;
      await this.put(probe, Buffer.from("ok"), "text/plain");
      const back = await this.get(probe);
      await this.remove(probe);
      const ok = back?.body.toString() === "ok";
      return {
        ok,
        detail: ok
          ? `Verified put/get/delete on ${this.cfg.bucket} (${this.cfg.endpoint || this.cfg.region})`
          : "Object written but could not be read back — check bucket policy",
      };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : "Unknown S3 error" };
    }
  }

  describe() {
    return `S3 · ${this.cfg.bucket}${this.cfg.endpoint ? ` @ ${this.cfg.endpoint}` : ` (${this.cfg.region})`}`;
  }
}

/* ------------------------------ factory --------------------------- */

export function storageFor(orgId: string): { driver: StorageDriver; config: StorageConfig } {
  const config = settings.get<StorageConfig>(orgId, "storage", DEFAULT_STORAGE);
  if (config.driver === "s3" && config.s3.bucket) {
    return { driver: new S3Driver(config.s3), config };
  }
  const root = path.isAbsolute(config.local.path)
    ? path.join(config.local.path, orgId)
    : path.join(DATA_DIR, "recordings", orgId);
  return { driver: new LocalDriver(root), config };
}

export function storageFromConfig(orgId: string, config: StorageConfig): StorageDriver {
  if (config.driver === "s3") return new S3Driver(config.s3);
  const root = path.isAbsolute(config.local.path)
    ? path.join(config.local.path, orgId)
    : path.join(DATA_DIR, "recordings", orgId);
  return new LocalDriver(root);
}
