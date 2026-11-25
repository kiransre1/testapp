import { existsSync } from "node:fs";
import path from "node:path";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type DbHandle = { db: Db; sql: postgres.Sql; close: () => Promise<void> };

export function createDb(url: string, opts: { max?: number } = {}): DbHandle {
  const sql = postgres(url, {
    max: opts.max ?? 10,
    onnotice: () => {},
    connect_timeout: 15,
    idle_timeout: 30,
  });
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}

/** Locate the versioned migrations folder in dev, test and bundled layouts. */
export function resolveMigrationsDir(): string {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(process.cwd(), "packages/db/drizzle"),
    path.resolve(process.cwd(), "../../packages/db/drizzle"),
    path.resolve(process.cwd(), "drizzle"),
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    if (existsSync(path.join(c, "meta", "_journal.json"))) return c;
  }
  throw new Error(`migrations folder not found (looked in: ${candidates.join(", ")})`);
}

export async function runMigrations(url: string): Promise<void> {
  const handle = createDb(url, { max: 1 });
  try {
    await migrate(handle.db, { migrationsFolder: resolveMigrationsDir() });
  } finally {
    await handle.close();
  }
}
