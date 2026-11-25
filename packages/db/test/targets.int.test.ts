import { targetInputSchema } from "@testapp/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../src";
import {
  addBriefVersion,
  createTarget,
  getDecryptedCredential,
  getPublicTarget,
  listBriefVersions,
  setCredential,
  updateTarget,
} from "../src/services/targets";
import { createTestDatabase, TEST_ENC_KEY } from "./helpers";

let t: Awaited<ReturnType<typeof createTestDatabase>>;
const SECRET = `synthetic-${Math.random().toString(36).slice(2)}`;

const input = targetInputSchema.parse({
  projectName: "Demo project",
  name: "Staging",
  baseUrl: "https://staging.example.test/app",
  brief: "A task management app. Users log in and manage tasks.",
  authorizationConfirmed: true,
  isStaging: true,
  allowedOrigins: ["https://staging.example.test"],
  authMode: "form",
  loginUrl: "https://staging.example.test/login",
  loginSuccessUrlContains: "/tasks",
  credentialUsername: "qa.bot@example.test",
  credentialPassword: SECRET,
});

beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});

describe("targets, briefs and credentials", () => {
  let targetId = "";

  it("persists target, project and brief v1", async () => {
    targetId = await createTarget(t.db, input, TEST_ENC_KEY);
    const tgt = await getPublicTarget(t.db, targetId);
    expect(tgt?.projectName).toBe("Demo project");
    expect(tgt?.allowedOrigins).toEqual(["https://staging.example.test"]);
    expect(tgt?.hasCredential).toBe(true);
    const briefs = await listBriefVersions(t.db, targetId);
    expect(briefs.map((b) => b.version)).toEqual([1]);
  });

  it("versions briefs", async () => {
    await addBriefVersion(t.db, targetId, "Updated brief content for the app under test.");
    const briefs = await listBriefVersions(t.db, targetId);
    expect(briefs.map((b) => b.version)).toEqual([2, 1]);
  });

  it("encrypts credentials at rest and never exposes them in the public view", async () => {
    const [row] = await t.db
      .select()
      .from(schema.targetCredentials)
      .where(eq(schema.targetCredentials.targetId, targetId));
    expect(row!.passwordEnc).not.toContain(SECRET);
    expect(row!.passwordEnc.startsWith("v1:")).toBe(true);
    const pub = await getPublicTarget(t.db, targetId);
    expect(JSON.stringify(pub)).not.toContain(SECRET);
    expect(JSON.stringify(pub)).not.toContain(row!.passwordEnc);
    const dec = await getDecryptedCredential(t.db, targetId, TEST_ENC_KEY);
    expect(dec?.password).toBe(SECRET);
  });

  it("fails to decrypt with the wrong key and supports rotation via setCredential", async () => {
    const wrong = Buffer.alloc(32, 1).toString("base64");
    await expect(getDecryptedCredential(t.db, targetId, wrong)).rejects.toThrow();
    await setCredential(
      t.db,
      targetId,
      { username: "qa2@example.test", password: "another-synthetic" },
      TEST_ENC_KEY,
    );
    expect((await getDecryptedCredential(t.db, targetId, TEST_ENC_KEY))?.username).toBe(
      "qa2@example.test",
    );
  });

  it("refuses an update that would leave the base URL un-allowlisted", async () => {
    await expect(
      updateTarget(t.db, targetId, { baseUrl: "https://other.example.test/" }),
    ).rejects.toThrow(/allowlisted/);
  });

  it("records audit events without secret values", async () => {
    const events = await t.db
      .select()
      .from(schema.runEvents)
      .where(eq(schema.runEvents.targetId, targetId));
    expect(events.map((e) => e.type)).toContain("target.created");
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });
});
