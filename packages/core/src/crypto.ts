import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Authenticated encryption for stored target credentials (AES-256-GCM).
 * Format: "v1:" + base64(iv[12] | tag[16] | ciphertext).
 * Associated data binds a ciphertext to its owning record so it cannot be
 * transplanted onto another target.
 */
const VERSION = "v1";

function keyFrom(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
  return key;
}

export function encryptSecret(plaintext: string, keyB64: string, associatedData: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(keyB64), iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, ct]).toString("base64")}`;
}

export function decryptSecret(token: string, keyB64: string, associatedData: string): string {
  const [version, body] = token.split(":", 2);
  if (version !== VERSION || !body) throw new Error("unsupported ciphertext format");
  const raw = Buffer.from(body, "base64");
  if (raw.length < 28) throw new Error("ciphertext too short");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(keyB64), iv);
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
