import { type JobKind, type JobRow, logEvent, reclaimStaleJobs } from "@testapp/db";
import type { WorkerContext } from "./context";
import { handleGeneratePlan } from "./jobs/plan";

export type JobHandler = (
  ctx: WorkerContext,
  payload: Record<string, string>,
  job: JobRow,
) => Promise<void>;

export const handlers: Record<JobKind, JobHandler> = {
  generate_plan: handleGeneratePlan,
  preflight: async () => {
    throw new Error("preflight jobs are not implemented in this build");
  },
  execute_run: async () => {
    throw new Error("run execution is not implemented in this build");
  },
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
