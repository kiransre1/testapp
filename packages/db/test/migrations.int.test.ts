import { afterAll, describe, expect, it } from "vitest";
import { runMigrations } from "../src/client";
import { createTestDatabase } from "./helpers";

let t: Awaited<ReturnType<typeof createTestDatabase>> | undefined;
afterAll(async () => {
  await t?.drop();
});

describe("migrations", () => {
  it("apply cleanly to an empty database and are idempotent", async () => {
    t = await createTestDatabase();
    const tables = await t.sql<{ table_name: string }[]>`
      select table_name from information_schema.tables where table_schema = 'public' order by table_name`;
    const names = tables.map((r) => r.table_name);
    for (const required of [
      "users",
      "sessions",
      "targets",
      "target_credentials",
      "runs",
      "scenario_results",
      "step_results",
      "artifacts",
      "findings",
      "jobs",
      "run_events",
    ]) {
      expect(names).toContain(required);
    }
    await expect(runMigrations(t.url)).resolves.toBeUndefined();
  });
});
