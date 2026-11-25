import { makeRunPrefix, targetInputSchema } from "@testapp/core";
import {
  claimNextJob,
  createPlanVersion,
  createRun,
  createScenarioResults,
  createTarget,
  enqueueJob,
  finishJob,
  getJob,
  getPlan,
  getRun,
  heartbeatJob,
  reclaimStaleJobs,
  requestCancel,
  schema,
  setRunStatus,
  updateScenarioResult,
} from "@testapp/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, TEST_ENC_KEY } from "../../../packages/db/test/helpers";
import { onStaleJobs } from "../src/dispatch";
import { handleGeneratePlan } from "../src/jobs/plan";
import { testContext } from "./helpers";

let t: Awaited<ReturnType<typeof createTestDatabase>>;
let targetId = "";
let planId = "";
const budgets = {
  maxElapsedMinutes: 5,
  maxScenarios: 5,
  maxActionsPerScenario: 10,
  maxTotalActions: 50,
  maxInputTokens: 1000,
  maxOutputTokens: 1000,
  maxEstimatedCostUsd: 1,
  maxRepeatedActions: 3,
  maxConsecutiveBlocked: 3,
};

beforeAll(async () => {
  t = await createTestDatabase();
  targetId = await createTarget(
    t.db,
    targetInputSchema.parse({
      projectName: "P",
      name: "TaskPad",
      baseUrl: "http://127.0.0.1:4999/",
      brief: "TaskPad is a small task manager.",
      authorizationConfirmed: true,
      isStaging: true,
      allowedOrigins: ["http://127.0.0.1:4999"],
      allowDisposableWrites: true,
      authMode: "none",
    }),
    TEST_ENC_KEY,
  );
  const pv = await createPlanVersion(t.db, {
    targetId,
    briefVersionId: null,
    provider: "fake",
    model: null,
    isFake: true,
  });
  await handleGeneratePlan(testContext(t.db, t.url), { targetId, planVersionId: pv.id });
  planId = pv.id;
});
afterAll(async () => {
  await t?.drop();
});

async function newRun() {
  return createRun(t.db, {
    targetId,
    planVersionId: planId,
    config: { browserProfile: "chromium-desktop", budgets, analyse: false },
    runPrefix: makeRunPrefix(),
    provider: "fake",
    isFake: true,
  });
}

describe("transactional job claiming", () => {
  it("never hands the same job to two concurrent workers", async () => {
    const jobs = await Promise.all(
      Array.from({ length: 5 }, (_, i) => enqueueJob(t.db, "generate_plan", { n: String(i) })),
    );
    const claims = await Promise.all(
      Array.from({ length: 12 }, (_, i) => claimNextJob(t.db, `w${i}`, 30)),
    );
    const claimed = claims.filter(Boolean).map((j) => j!.id);
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed.sort()).toEqual(jobs.map((j) => j.id).sort());
    for (const id of claimed) {
      const j = await getJob(t.db, id);
      expect(j?.status).toBe("running");
      expect(j?.attempts).toBe(1);
    }
    // Clean up so later tests start from an empty queue.
    await t.db
      .update(schema.jobs)
      .set({ status: "succeeded" })
      .where(eq(schema.jobs.status, "running"));
  });

  it("heartbeats only succeed for the current lease owner", async () => {
    const j = await enqueueJob(t.db, "preflight", { preflightId: "x" });
    const c = await claimNextJob(t.db, "owner", 30);
    expect(c?.id).toBe(j.id);
    expect(await heartbeatJob(t.db, j.id, "owner", 30)).toBe(true);
    expect(await heartbeatJob(t.db, j.id, "intruder", 30)).toBe(false);
    await finishJob(t.db, j.id, "owner", "succeeded");
    expect(await heartbeatJob(t.db, j.id, "owner", 30)).toBe(false);
  });
});

describe("lease expiry and interrupted runs", () => {
  it("requeues retryable jobs and fails execute_run jobs without re-executing them", async () => {
    const plan = await enqueueJob(t.db, "generate_plan", {
      targetId: "a",
      planVersionId: "00000000-0000-0000-0000-000000000000",
    });
    const run = await newRun();
    const exec = await enqueueJob(t.db, "execute_run", { runId: run.id });
    await claimNextJob(t.db, "crashed", 30);
    await claimNextJob(t.db, "crashed", 30);
    await t.db
      .update(schema.jobs)
      .set({ leaseExpiresAt: sql`now() - interval '1 minute'` })
      .where(eq(schema.jobs.leaseOwner, "crashed"));
    const r = await reclaimStaleJobs(t.db);
    expect(r.requeued.map((j) => j.id)).toContain(plan.id);
    expect(r.failed.map((j) => j.id)).toContain(exec.id);
    expect((await getJob(t.db, exec.id))?.status).toBe("failed");
  });

  it("marks an interrupted run partial with inconclusive/skipped scenarios and keeps evidence", async () => {
    const run = await newRun();
    const p = await getPlan(t.db, planId);
    const results = await createScenarioResults(
      t.db,
      run.id,
      p!.scenarios
        .slice(0, 3)
        .map((s, i) => ({ scenarioId: s.id, definition: s.definition, ordinal: i })),
    );
    await setRunStatus(t.db, run.id, "preflighting");
    await setRunStatus(t.db, run.id, "running");
    await updateScenarioResult(t.db, results[0]!.id, { status: "passed" });
    await updateScenarioResult(t.db, results[1]!.id, { status: "running" });
    // Isolate the queue from jobs requeued by earlier tests.
    await t.db
      .update(schema.jobs)
      .set({ status: "succeeded" })
      .where(eq(schema.jobs.status, "queued"));
    const job = await enqueueJob(t.db, "execute_run", { runId: run.id });
    expect((await claimNextJob(t.db, "dead-worker", 30))?.id).toBe(job.id);
    await t.db
      .update(schema.jobs)
      .set({ leaseExpiresAt: sql`now() - interval '1 minute'` })
      .where(eq(schema.jobs.id, job.id));
    await onStaleJobs(testContext(t.db, t.url));
    const after = await getRun(t.db, run.id);
    expect(after?.status).toBe("partial");
    expect(after?.statusReason).toMatch(/interrupted/);
    const rows = await t.db
      .select()
      .from(schema.scenarioResults)
      .where(eq(schema.scenarioResults.runId, run.id));
    const st = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(st[results[0]!.id]).toBe("passed");
    expect(st[results[1]!.id]).toBe("inconclusive");
    expect(st[results[2]!.id]).toBe("skipped");
    // A report is still produced for the partial run.
    const arts = await t.db
      .select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.runId, run.id));
    expect(arts.map((a) => a.kind)).toEqual(expect.arrayContaining(["report_json", "fix_packet"]));
  });
});

describe("cancellation", () => {
  it("cancels a queued run immediately and flags a running run", async () => {
    const queued = await newRun();
    expect((await requestCancel(t.db, queued.id))?.status).toBe("cancelled");
    const running = await newRun();
    await setRunStatus(t.db, running.id, "preflighting");
    const r = await requestCancel(t.db, running.id);
    expect(r?.status).toBe("preflighting");
    expect(r?.cancelRequested).toBe(true);
    // Terminal runs are immutable.
    await expect(setRunStatus(t.db, queued.id, "running")).rejects.toThrow(/illegal/);
  });
});
