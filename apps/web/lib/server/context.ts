import { loadServerEnv, type ServerEnv } from "@testapp/core";
import { createDb, type DbHandle } from "@testapp/db";

/**
 * Lazily-initialised process singletons. Never touched at import time so that
 * `next build` does not require runtime secrets.
 */
type Ctx = { env: ServerEnv; handle: DbHandle };
const g = globalThis as unknown as { __testappCtx?: Ctx };

function ctx(): Ctx {
  if (!g.__testappCtx) {
    const env = loadServerEnv();
    g.__testappCtx = { env, handle: createDb(env.DATABASE_URL, { max: 10 }) };
  }
  return g.__testappCtx;
}

export const getEnv = () => ctx().env;
export const getDb = () => ctx().handle.db;
export const getSql = () => ctx().handle.sql;
