import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Private artifact storage. Keys are opaque, generated server-side, and never
 * derived from user input, so they cannot escape the storage root. The local
 * implementation can be swapped for an S3-compatible one behind this interface.
 */
export interface ArtifactStore {
  put(
    prefix: string,
    ext: string,
    data: Buffer,
  ): Promise<{ key: string; size: number; sha256: string }>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  healthCheck(): Promise<void>;
}

const KEY_RE = /^[a-z0-9-]+\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/;

export class LocalFsStore implements ArtifactStore {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    if (!KEY_RE.test(key)) throw new Error("invalid artifact key");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep))
      throw new Error("invalid artifact key");
    return full;
  }

  async put(prefix: string, ext: string, data: Buffer) {
    const safePrefix =
      prefix
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .slice(0, 60) || "misc";
    const safeExt =
      ext
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 8) || "bin";
    const key = `${safePrefix}/${randomUUID()}.${safeExt}`;
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    await writeFile(full, data, { mode: 0o600 });
    return { key, size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async healthCheck(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const probe = await this.put("healthcheck", "txt", Buffer.from("ok"));
    const back = await this.get(probe.key);
    await this.remove(probe.key);
    if (back.toString() !== "ok") throw new Error("artifact storage read-back mismatch");
    await stat(this.root);
  }
}

export function artifactRoot(dataDir: string): string {
  return path.resolve(dataDir, "artifacts");
}
