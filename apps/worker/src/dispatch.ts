import { type JobKind, type JobRow, logEvent, reclaimStaleJobs } from "@testapp/db";
import type { WorkerContext } from "./context";
import { handleGeneratePlan } from "./jobs/plan";
import { handlePreflight, markPreflightInterrupted } from "./jobs/preflight";
import { handleExecuteRun, markRunInterrupted } from "./jobs/run";

export type JobHandler = (
  ctx: WorkerContext,
  payload: Record<string, string>,
  job: JobRow,
) => Promise<void>;

export const handlers: Record<JobKind, JobHandler> = {
  generate_plan: handleGeneratePlan,
  preflight: handlePreflight,
  execute_run: handleExecuteRun,
};

/** Recover from crashed/restarted workers: requeue or fail stale jobs and fix domain state. */
export async function onStaleJobs(ctx: WorkerContext): Promise<void> {
  const { requeued, failed } = await reclaimStaleJobs(ctx.db);
  for (const job of requeued) {
    await logEvent(ctx.db, {
      jobId: job.id,
      level: "warn",
      type: "job.requeued",
      message: `${job.kind} lease expired; requeued`,
    });
  }
  for (const job of failed) {
    await logEvent(ctx.db, {
      jobId: job.id,
      level: "warn",
      type: "job.interrupted",
      message: `${job.kind} interrupted by worker stop`,
    });
    if (job.kind === "execute_run" && job.payload.runId)
      await markRunInterrupted(ctx, job.payload.runId);
    if (job.kind === "preflight" && job.payload.preflightId)
      await markPreflightInterrupted(ctx, job.payload.preflightId);
    if (job.kind === "generate_plan" && job.payload.planVersionId) {
      const { failPlanVersion } = await import("@testapp/db");
      await failPlanVersion(
        ctx.db,
        job.payload.planVersionId,
        "interrupted: worker stopped during generation",
      );
    }
  }
}
