import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalFsStore } from "../src/storage";

describe("private artifact storage", () => {
  const root = mkdtempSync(path.join(tmpdir(), "store-"));
  const store = new LocalFsStore(root);

  it("stores and reads back with integrity metadata", async () => {
    const r = await store.put("run-abc", "png", Buffer.from("hello"));
    expect(r.key).toMatch(/^run-abc\/[0-9a-f-]{36}\.png$/);
    expect(r.sha256).toHaveLength(64);
    expect((await store.get(r.key)).toString()).toBe("hello");
  });

  it("rejects keys that could escape the storage root", async () => {
    for (const bad of [
      "../etc/passwd",
      "run/../../x.png",
      "/abs/path.png",
      "run-a/not-a-uuid.png",
    ]) {
      await expect(store.get(bad)).rejects.toThrow(/invalid artifact key/);
    }
  });

  it("sanitises prefixes and extensions supplied by callers", async () => {
    const r = await store.put("../../Evil Prefix", "p/n.g", Buffer.from("x"));
    expect(r.key.startsWith("------evil-prefix/")).toBe(true);
    expect(r.key.endsWith(".png")).toBe(true);
  });
});
