import type { ArtifactStore, LlmProvider, ServerEnv } from "@testapp/core";
import type { Db } from "@testapp/db";

export type WorkerContext = {
  env: ServerEnv;
  db: Db;
  provider: LlmProvider;
  store: ArtifactStore;
  workerId: string;
  /** Set when the process is shutting down; long jobs stop between actions. */
  shuttingDown: () => boolean;
  log: (msg: string, data?: Record<string, unknown>) => void;
};
