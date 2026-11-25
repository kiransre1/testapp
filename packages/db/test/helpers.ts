import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { createDb, type DbHandle, runMigrations } from "../src/client";

/**
 * Creates an isolated, freshly migrated database for one test file and drops
 * it afterwards. Requires TEST_DATABASE_URL (a server where the user may
 * CREATE DATABASE). Tests fail loudly — they are never silently skipped.
 */
export function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set; integration tests need PostgreSQL");
  return url;
}

export async function createTestDatabase(): Promise<
  DbHandle & { url: string; drop: () => Promise<void> }
> {
  const adminUrl = requireTestDatabaseUrl();
  const name = `testapp_t_${randomBytes(6).toString("hex")}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();
  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  const url = u.toString();
  await runMigrations(url);
  const handle = createDb(url, { max: 5 });
  return {
    ...handle,
    url,
    drop: async () => {
      await handle.close();
      const a = postgres(adminUrl, { max: 1, onnotice: () => {} });
      await a.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}

export const TEST_ENC_KEY = randomBytes(32).toString("base64");
