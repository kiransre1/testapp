import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, safeEqual } from "../src/crypto";
import { REDACTED, redactDeep, redactSecrets, sanitizeUrl } from "../src/redact";

const key = randomBytes(32).toString("base64");

describe("credential encryption", () => {
  it("round-trips and produces distinct ciphertexts", () => {
    const a = encryptSecret("s3cret-value", key, "t:1:password");
    const b = encryptSecret("s3cret-value", key, "t:1:password");
    expect(a).not.toBe(b);
    expect(a).not.toContain("s3cret");
    expect(decryptSecret(a, key, "t:1:password")).toBe("s3cret-value");
  });

  it("is authenticated: tampering, wrong AAD or wrong key fail", () => {
    const ct = encryptSecret("value-123", key, "t:1:password");
    expect(() => decryptSecret(ct, key, "t:2:password")).toThrow();
    expect(() => decryptSecret(ct, randomBytes(32).toString("base64"), "t:1:password")).toThrow();
    const raw = Buffer.from(ct.slice(3), "base64");
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1;
    expect(() => decryptSecret(`v1:${raw.toString("base64")}`, key, "t:1:password")).toThrow();
  });

  it("rejects malformed keys and formats", () => {
    expect(() => encryptSecret("x", Buffer.alloc(16).toString("base64"), "a")).toThrow(/32 bytes/);
    expect(() => decryptSecret("v0:abc", key, "a")).toThrow();
  });

  it("safeEqual compares strings in constant time semantics", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("redaction", () => {
  it("removes secret values including URL-encoded forms", () => {
    const s = "p@ss word!";
    const text = `typed ${s} and sent ${encodeURIComponent(s)}`;
    const out = redactSecrets(text, [s]);
    expect(out).not.toContain(s);
    expect(out).not.toContain(encodeURIComponent(s));
    expect(out).toContain(REDACTED);
  });

  it("deep-redacts objects and sensitive keys", () => {
    const out = redactDeep(
      { a: ["x hunter22 y"], password: "anything", nested: { token: "t", ok: 1 } },
      ["hunter22"],
    );
    expect(JSON.stringify(out)).not.toContain("hunter22");
    expect(out.password).toBe(REDACTED);
    expect(out.nested.token).toBe(REDACTED);
    expect(out.nested.ok).toBe(1);
  });

  it("sanitizes URLs by removing query, fragment and credentials", () => {
    expect(sanitizeUrl("https://u:p@example.test/a/b?token=abc#frag")).toBe(
      "https://example.test/a/b",
    );
    expect(sanitizeUrl("/relative?x=1")).toBe("/relative");
    expect(sanitizeUrl("data:text/html,<script>")).toBe("data:[omitted]");
  });
});
