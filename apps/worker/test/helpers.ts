import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalFsStore, loadServerEnv, type LlmProvider } from "@testapp/core";
import type { Db } from "@testapp/db";
import type { WorkerContext } from "../src/context";
import { FakeProvider } from "../src/llm/fake";

export const fixtureDir = path.resolve(__dirname, "../../../packages/core/fixtures");

export function testContext(
  db: Db,
  url: string,
  overrides: Partial<WorkerContext> & { provider?: LlmProvider } = {},
): WorkerContext {
  const dataDir = mkdtempSync(path.join(tmpdir(), "testapp-worker-"));
  const env = loadServerEnv({
    DATABASE_URL: url,
    SESSION_SECRET: "s".repeat(40),
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    DATA_DIR: dataDir,
    DEMO_MODE: "true",
    DEMO_TARGET_HOSTNAMES: "127.0.0.1,localhost",
    ...(overrides.env as unknown as Record<string, string> | undefined),
  });
  return {
    env,
    db,
    provider: new FakeProvider(fixtureDir),
    store: new LocalFsStore(path.join(dataDir, "artifacts")),
    workerId: "test-worker",
    shuttingDown: () => false,
    log: () => undefined,
    ...overrides,
    ...(overrides.env ? { env } : {}),
  };
}
