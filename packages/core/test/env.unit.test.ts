import { describe, expect, it } from "vitest";
import { ConfigError, describeConfig, loadServerEnv } from "../src/env";

const valid = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  SESSION_SECRET: "x".repeat(40),
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};

describe("loadServerEnv", () => {
  it("accepts a minimal valid config and applies defaults", () => {
    const env = loadServerEnv(valid);
    expect(env.LLM_PROVIDER).toBe("fake");
    expect(env.DEFAULT_MAX_SCENARIOS).toBeGreaterThan(0);
  });

  it("rejects short encryption keys without echoing the value", () => {
    try {
      loadServerEnv({ ...valid, APP_ENCRYPTION_KEY: "c2hvcnQ=" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect(String(e)).toContain("APP_ENCRYPTION_KEY");
      expect(String(e)).not.toContain("c2hvcnQ=");
    }
  });

  it("requires a key and model for the anthropic provider", () => {
    expect(() => loadServerEnv({ ...valid, LLM_PROVIDER: "anthropic" })).toThrow(/ANTHROPIC_MODEL/);
  });

  it("redacts secrets in describeConfig", () => {
    const d = describeConfig(loadServerEnv(valid));
    expect(d.SESSION_SECRET).toBe("[set]");
    expect(JSON.stringify(d)).not.toContain("xxxxxxxx");
  });
});
