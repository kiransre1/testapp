import { makeRunPrefix, type RunConfig } from "@testapp/core";
import { createRun, enqueueJob, getPublicTarget, logEvent, schema } from "@testapp/db";
import { eq } from "drizzle-orm";
import { getDb, getEnv } from "./context";
import { HttpError } from "./api";

/** Create a queued run and its worker job. Execution never happens in the request. */
export async function startRun(planVersionId: string, config: RunConfig, rerunOfRunId?: string) {
  const db = getDb();
  const [plan] = await db
    .select()
    .from(schema.testPlanVersions)
    .where(eq(schema.testPlanVersions.id, planVersionId));
  if (!plan) throw new HttpError(404, "plan not found");
  if (plan.status !== "ready") throw new HttpError(409, "plan is not ready");
  const target = await getPublicTarget(db, plan.targetId);
  if (!target) throw new HttpError(404, "target not found");
  const env = getEnv();
  const run = await createRun(db, {
    targetId: plan.targetId,
    planVersionId,
    config,
    runPrefix: makeRunPrefix(),
    provider: env.LLM_PROVIDER,
    isFake: env.LLM_PROVIDER === "fake",
    rerunOfRunId,
    targetBuildLabel: target.buildLabel,
  });
  const job = await enqueueJob(db, "execute_run", { runId: run.id });
  await db.update(schema.runs).set({ jobId: job.id }).where(eq(schema.runs.id, run.id));
  await logEvent(db, {
    runId: run.id,
    targetId: plan.targetId,
    type: "run.queued",
    message: `run queued (${config.browserProfile})`,
  });
  return run;
}
