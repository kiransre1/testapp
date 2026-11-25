import { writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { artifactRoot, describeConfig, LocalFsStore, loadServerEnv } from "@testapp/core";
import {
  claimNextJob,
  createDb,
  finishJob,
  type JobRow,
  heartbeatJob,
  logEvent,
} from "@testapp/db";
import type { WorkerContext } from "./context";
import { handlers, onStaleJobs } from "./dispatch";
import { createProvider } from "./llm";

const env = loadServerEnv();
const handle = createDb(env.DATABASE_URL, { max: 5 });
const workerId = env.WORKER_ID ?? `${hostname()}-${process.pid}`;
let stopping = false;

const log = (msg: string, data?: Record<string, unknown>) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), worker: workerId, msg, ...data }));

const ctx: WorkerContext = {
  env,
  db: handle.db,
  provider: createProvider(env),
  store: new LocalFsStore(artifactRoot(env.DATA_DIR)),
  workerId,
  shuttingDown: () => stopping,
  log,
};

function touchHeartbeatFile() {
  try {
    writeFileSync("/tmp/worker-heartbeat", String(Date.now()));
  } catch {
    /* non-fatal: only used by the container health check */
  }
}

async function runJob(job: JobRow): Promise<void> {
  const handler = handlers[job.kind];
  const beat = setInterval(
    () => {
      heartbeatJob(ctx.db, job.id, workerId, env.WORKER_LEASE_SECONDS)
        .then((ok) => {
          if (!ok) log("lease lost", { jobId: job.id });
        })
        .catch(() => undefined);
      touchHeartbeatFile();
    },
    Math.max(1000, (env.WORKER_LEASE_SECONDS * 1000) / 3),
  );
  try {
    log("job started", { jobId: job.id, kind: job.kind });
    await handler(ctx, job.payload, job);
    await finishJob(ctx.db, job.id, workerId, "succeeded");
    log("job finished", { jobId: job.id, kind: job.kind });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishJob(ctx.db, job.id, workerId, "failed", message);
    await logEvent(ctx.db, {
      jobId: job.id,
      level: "error",
      type: "job.failed",
      message: `${job.kind} failed: ${message}`,
    }).catch(() => undefined);
    log("job failed", { jobId: job.id, kind: job.kind, error: message });
  } finally {
    clearInterval(beat);
  }
}

async function loop(): Promise<void> {
  await ctx.store.healthCheck();
  log("worker started", {
    config: describeConfig(env),
    provider: ctx.provider.name,
    fake: ctx.provider.isFake,
  });
  let iteration = 0;
  while (!stopping) {
    touchHeartbeatFile();
    try {
      if (iteration % 10 === 0) await onStaleJobs(ctx);
      iteration++;
      const job = await claimNextJob(ctx.db, workerId, env.WORKER_LEASE_SECONDS);
      if (job) {
        await runJob(job);
        continue;
      }
    } catch (err) {
      log("poll error", { error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => setTimeout(r, env.WORKER_POLL_INTERVAL_MS));
  }
  log("worker stopping");
  await handle.close();
}

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    if (stopping) process.exit(1);
    stopping = true;
    log(`received ${sig}; finishing current action then exiting`);
  });
}

loop().catch((err) => {
  log("worker crashed", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
