import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bootstrapAdmin,
  getSession,
  login,
  logout,
  MAX_FAILURES_PER_ACCOUNT,
} from "../src/services/auth";
import { schema } from "../src";
import { createTestDatabase } from "./helpers";

let t: Awaited<ReturnType<typeof createTestDatabase>>;
const EMAIL = "owner@example.test";
const PASSWORD = `pw-${Math.random().toString(36).slice(2)}-long-enough`;

beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});

describe("single-user authentication", () => {
  it("bootstraps exactly one user and stores only an argon2id hash", async () => {
    expect(await bootstrapAdmin(t.db, EMAIL, PASSWORD)).toBe("created");
    expect(await bootstrapAdmin(t.db, "second@example.test", PASSWORD)).toBe("exists");
    const users = await t.db.select().from(schema.users);
    expect(users).toHaveLength(1);
    expect(users[0]!.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(users[0]!.passwordHash).not.toContain(PASSWORD);
  });

  it("rejects short bootstrap passwords", async () => {
    await expect(bootstrapAdmin(t.db, EMAIL, "short")).rejects.toThrow(/at least/);
  });

  it("issues an opaque session stored only as a hash", async () => {
    const r = await login(t.db, {
      email: EMAIL.toUpperCase(),
      password: PASSWORD,
      clientKey: "c1",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rows = await t.db.select().from(schema.sessions);
    expect(rows.some((s) => s.id === r.token)).toBe(false);
    const s = await getSession(t.db, r.token);
    expect(s?.email).toBe(EMAIL);
    expect(s?.csrfToken).toBe(r.csrfToken);
    await logout(t.db, r.token);
    expect(await getSession(t.db, r.token)).toBeNull();
  });

  it("rejects bad passwords, unknown users and expired sessions", async () => {
    expect(
      (await login(t.db, { email: EMAIL, password: "wrong-password-x", clientKey: "c2" })).ok,
    ).toBe(false);
    expect(
      (await login(t.db, { email: "nobody@example.test", password: PASSWORD, clientKey: "c2" })).ok,
    ).toBe(false);
    const r = await login(t.db, { email: EMAIL, password: PASSWORD, clientKey: "c2" });
    if (!r.ok) throw new Error("login failed");
    const later = new Date(r.expiresAt.getTime() + 1000);
    expect(await getSession(t.db, r.token, later)).toBeNull();
    expect(await getSession(t.db, "not-a-real-token-but-long-enough")).toBeNull();
  });

  it("rate limits repeated failures per account", async () => {
    const victim = "ratelimit@example.test";
    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i++) {
      await login(t.db, { email: victim, password: "nope-nope-nope", clientKey: `rl-${i}` });
    }
    const r = await login(t.db, { email: victim, password: "nope-nope-nope", clientKey: "rl-x" });
    expect(r).toEqual({ ok: false, reason: "rate_limited" });
  });
});
