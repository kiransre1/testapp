import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { jobs } from "../schema";

export type JobRow = typeof jobs.$inferSelect;
export type JobKind = JobRow["kind"];

export async function enqueueJob(
  db: Db,
  kind: JobKind,
  payload: Record<string, string>,
  opts: { maxAttempts?: number } = {},
): Promise<JobRow> {
  const [row] = await db
    .insert(jobs)
    .values({ kind, payload, maxAttempts: opts.maxAttempts ?? (kind === "execute_run" ? 1 : 2) })
    .returning();
  return row!;
}

/**
 * Atomically claim the oldest queued job. FOR UPDATE SKIP LOCKED guarantees two
 * workers can never claim the same row; the lease marks ownership.
 */
export async function claimNextJob(
  db: Db,
  workerId: string,
  leaseSeconds: number,
): Promise<JobRow | null> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE jobs SET
      status = 'running',
      lease_owner = ${workerId},
      lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
      heartbeat_at = now(),
      started_at = coalesce(started_at, now()),
      attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'queued'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id`);
  const id = rows[0]?.id;
  if (!id) return null;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  return job ?? null;
}

/** Extend the lease. Returns false when the lease was lost (e.g. reclaimed as stale). */
export async function heartbeatJob(
  db: Db,
  jobId: string,
  workerId: string,
  leaseSeconds: number,
): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({
      heartbeatAt: sql`now()`,
      leaseExpiresAt: sql`now() + make_interval(secs => ${leaseSeconds})`,
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.leaseOwner, workerId), eq(jobs.status, "running")))
    .returning({ id: jobs.id });
  return rows.length === 1;
}

export async function finishJob(
  db: Db,
  jobId: string,
  workerId: string,
  status: "succeeded" | "failed" | "cancelled",
  error?: string,
): Promise<void> {
  await db
    .update(jobs)
    .set({ status, error: error?.slice(0, 2000), finishedAt: sql`now()`, leaseExpiresAt: null })
    .where(and(eq(jobs.id, jobId), eq(jobs.leaseOwner, workerId)));
}

/**
 * Find running jobs whose lease expired (worker crashed or was restarted).
 * Jobs with attempts left are requeued; others are marked failed. Returns the
 * affected jobs so callers can clean up domain state (e.g. mark runs partial).
 * execute_run jobs are never retried automatically: re-executing browser
 * actions could duplicate side effects on the target.
 */
export async function reclaimStaleJobs(db: Db): Promise<{ requeued: JobRow[]; failed: JobRow[] }> {
  return db.transaction(async (tx) => {
    const stale = await tx.execute<{ id: string }>(sql`
      SELECT id FROM jobs
      WHERE status = 'running' AND lease_expires_at < now()
      FOR UPDATE SKIP LOCKED`);
    const requeued: JobRow[] = [];
    const failed: JobRow[] = [];
    for (const { id } of stale) {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, id));
      if (!job) continue;
      if (job.kind !== "execute_run" && job.attempts < job.maxAttempts) {
        const [r] = await tx
          .update(jobs)
          .set({
            status: "queued",
            leaseOwner: null,
            leaseExpiresAt: null,
            error: "lease expired; requeued",
          })
          .where(eq(jobs.id, id))
          .returning();
        requeued.push(r!);
      } else {
        const [r] = await tx
          .update(jobs)
          .set({
            status: "failed",
            leaseExpiresAt: null,
            finishedAt: sql`now()`,
            error: "lease expired: worker stopped while running this job",
          })
          .where(eq(jobs.id, id))
          .returning();
        failed.push(r!);
      }
    }
    return { requeued, failed };
  });
}

export async function getJob(db: Db, id: string): Promise<JobRow | null> {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row ?? null;
}
