import {
  assertRunTransition,
  type BudgetUsage,
  type Finding,
  type RunConfig,
  type RunStatus,
  type Scenario,
  type ScenarioStatus,
  TERMINAL_RUN_STATUSES,
} from "@testapp/core";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client";
import {
  artifacts,
  findings,
  recommendations,
  runEvents,
  runs,
  scenarioResults,
  stepResults,
  targets,
  testPlanVersions,
} from "../schema";
import type { BrowserEvent } from "../schema";

export type RunRow = typeof runs.$inferSelect;
export type ScenarioResultRow = typeof scenarioResults.$inferSelect;
export type StepResultRow = typeof stepResults.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
export type FindingRow = typeof findings.$inferSelect;

export async function createRun(
  db: Db,
  r: {
    targetId: string;
    planVersionId: string;
    config: RunConfig;
    runPrefix: string;
    provider: string;
    isFake: boolean;
    jobId?: string;
    rerunOfRunId?: string;
    targetBuildLabel?: string | null;
  },
): Promise<RunRow> {
  const [row] = await db
    .insert(runs)
    .values({ ...r, status: "queued" })
    .returning();
  return row!;
}

export async function getRun(db: Db, id: string): Promise<RunRow | null> {
  const [row] = await db.select().from(runs).where(eq(runs.id, id));
  return row ?? null;
}

/** Transition a run, enforcing the state machine. Terminal runs are immutable. */
export async function setRunStatus(
  db: Db,
  id: string,
  to: RunStatus,
  extra: Partial<
    Pick<
      RunRow,
      | "statusReason"
      | "budgetExhausted"
      | "budgetUsage"
      | "browser"
      | "viewport"
      | "analysisSummary"
    >
  > = {},
): Promise<RunRow> {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(runs).where(eq(runs.id, id)).for("update");
    if (!cur) throw new Error("run not found");
    assertRunTransition(cur.status, to);
    const now = new Date();
    const [row] = await tx
      .update(runs)
      .set({
        status: to,
        ...extra,
        startedAt: cur.startedAt ?? (to !== "queued" ? now : null),
        finishedAt: TERMINAL_RUN_STATUSES.has(to) ? now : null,
      })
      .where(eq(runs.id, id))
      .returning();
    await tx.insert(runEvents).values({
      runId: id,
      type: "run.status",
      message: `${cur.status} → ${to}${extra.statusReason ? `: ${extra.statusReason}` : ""}`,
    });
    return row!;
  });
}

export async function updateRunUsage(db: Db, id: string, usage: BudgetUsage): Promise<void> {
  await db.update(runs).set({ budgetUsage: usage }).where(eq(runs.id, id));
}

export async function requestCancel(db: Db, id: string): Promise<RunRow | null> {
  const run = await getRun(db, id);
  if (!run) return null;
  if (TERMINAL_RUN_STATUSES.has(run.status)) return run;
  await db.update(runs).set({ cancelRequested: true }).where(eq(runs.id, id));
  await db.insert(runEvents).values({
    runId: id,
    level: "warn",
    type: "run.cancel_requested",
    message: "emergency stop requested",
  });
  // A queued run that no worker has started can be cancelled immediately.
  if (run.status === "queued")
    return setRunStatus(db, id, "cancelled", { statusReason: "cancelled before start" });
  return getRun(db, id);
}

export async function isCancelRequested(db: Db, id: string): Promise<boolean> {
  const [row] = await db.select({ c: runs.cancelRequested }).from(runs).where(eq(runs.id, id));
  return row?.c ?? true;
}

export async function createScenarioResults(
  db: Db,
  runId: string,
  items: { scenarioId: string | null; definition: Scenario; ordinal: number }[],
): Promise<ScenarioResultRow[]> {
  if (!items.length) return [];
  return db
    .insert(scenarioResults)
    .values(
      items.map((i) => ({
        runId,
        scenarioId: i.scenarioId,
        scenarioKey: i.definition.key,
        scenarioVersion: i.definition.version,
        title: i.definition.title,
        ordinal: i.ordinal,
        definition: i.definition,
      })),
    )
    .returning();
}

export async function updateScenarioResult(
  db: Db,
  id: string,
  patch: {
    status?: ScenarioStatus;
    reason?: string | null;
    actionCount?: number;
    browserEvents?: BrowserEvent[];
    startedAt?: Date;
    finishedAt?: Date;
    durationMs?: number;
  },
): Promise<void> {
  await db.update(scenarioResults).set(patch).where(eq(scenarioResults.id, id));
}

export async function insertStepResult(
  db: Db,
  v: typeof stepResults.$inferInsert,
): Promise<StepResultRow> {
  const [row] = await db.insert(stepResults).values(v).returning();
  return row!;
}

export async function insertArtifact(
  db: Db,
  v: typeof artifacts.$inferInsert,
): Promise<ArtifactRow> {
  const [row] = await db.insert(artifacts).values(v).returning();
  return row!;
}

export async function getArtifact(db: Db, id: string): Promise<ArtifactRow | null> {
  const [row] = await db.select().from(artifacts).where(eq(artifacts.id, id));
  return row ?? null;
}

export async function replaceFindings(db: Db, runId: string, items: Finding[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(findings).where(eq(findings.runId, runId));
    if (!items.length) return;
    await tx.insert(findings).values(
      items.map((f) => ({
        runId,
        key: f.key,
        fingerprint: f.fingerprint,
        category: f.category,
        title: f.title,
        severity: f.severity,
        priority: f.priority,
        confidence: f.confidence,
        source: f.source,
        scenarioKey: f.scenarioKey,
        data: {
          description: f.description,
          personaKey: f.personaKey,
          journeyKey: f.journeyKey,
          preconditions: f.preconditions,
          reproSteps: f.reproSteps,
          expected: f.expected,
          actual: f.actual,
          pageUrl: f.pageUrl,
          targetVersion: f.targetVersion,
          browser: f.browser,
          viewport: f.viewport,
          evidence: f.evidence,
          reproducibility: f.reproducibility,
          occurrences: f.occurrences,
          suggestedRegressionTest: f.suggestedRegressionTest,
          standardsRefs: f.standardsRefs,
        },
      })),
    );
  });
}

export function findingFromRow(r: FindingRow): Finding {
  const { data } = r;
  return {
    key: r.key,
    fingerprint: r.fingerprint,
    category: r.category,
    title: r.title,
    severity: r.severity,
    priority: r.priority as Finding["priority"],
    confidence: r.confidence,
    source: r.source as Finding["source"],
    scenarioKey: r.scenarioKey ?? undefined,
    description: data.description,
    personaKey: data.personaKey,
    journeyKey: data.journeyKey,
    preconditions: data.preconditions,
    reproSteps: data.reproSteps,
    expected: data.expected,
    actual: data.actual,
    pageUrl: data.pageUrl,
    targetVersion: data.targetVersion,
    browser: data.browser,
    viewport: data.viewport,
    evidence: data.evidence,
    reproducibility: data.reproducibility as Finding["reproducibility"],
    occurrences: data.occurrences,
    suggestedRegressionTest: data.suggestedRegressionTest,
    standardsRefs: data.standardsRefs,
  };
}

export async function replaceRecommendations(
  db: Db,
  runId: string,
  items: { kind: "ux" | "agentic"; data: (typeof recommendations.$inferInsert)["data"] }[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(recommendations).where(eq(recommendations.runId, runId));
    if (items.length) await tx.insert(recommendations).values(items.map((i) => ({ runId, ...i })));
  });
}

export async function getRunDetail(db: Db, runId: string) {
  const run = await getRun(db, runId);
  if (!run) return null;
  const [target] = await db.select().from(targets).where(eq(targets.id, run.targetId));
  const [plan] = await db
    .select()
    .from(testPlanVersions)
    .where(eq(testPlanVersions.id, run.planVersionId));
  const [scen, steps, arts, finds, recs, events] = await Promise.all([
    db
      .select()
      .from(scenarioResults)
      .where(eq(scenarioResults.runId, runId))
      .orderBy(asc(scenarioResults.ordinal)),
    db
      .select()
      .from(stepResults)
      .where(eq(stepResults.runId, runId))
      .orderBy(asc(stepResults.index)),
    db.select().from(artifacts).where(eq(artifacts.runId, runId)).orderBy(asc(artifacts.createdAt)),
    db.select().from(findings).where(eq(findings.runId, runId)).orderBy(asc(findings.key)),
    db
      .select()
      .from(recommendations)
      .where(eq(recommendations.runId, runId))
      .orderBy(asc(recommendations.createdAt)),
    db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(desc(runEvents.id))
      .limit(200),
  ]);
  return {
    run,
    target: target!,
    plan: plan!,
    scenarios: scen,
    steps,
    artifacts: arts,
    findings: finds,
    recommendations: recs,
    events,
  };
}

export async function listRuns(db: Db, opts: { targetId?: string; limit?: number } = {}) {
  const q = db
    .select({
      id: runs.id,
      status: runs.status,
      createdAt: runs.createdAt,
      finishedAt: runs.finishedAt,
      isFake: runs.isFake,
      browser: runs.browser,
      targetId: runs.targetId,
      targetName: targets.name,
      planVersionId: runs.planVersionId,
      planVersion: testPlanVersions.version,
      rerunOfRunId: runs.rerunOfRunId,
      budgetExhausted: runs.budgetExhausted,
      config: runs.config,
    })
    .from(runs)
    .innerJoin(targets, eq(targets.id, runs.targetId))
    .innerJoin(testPlanVersions, eq(testPlanVersions.id, runs.planVersionId))
    .orderBy(desc(runs.createdAt))
    .limit(opts.limit ?? 100);
  return opts.targetId ? q.where(eq(runs.targetId, opts.targetId)) : q;
}

export async function scenarioStatusCounts(db: Db, runIds: string[]) {
  if (!runIds.length) return [];
  return db
    .select({
      runId: scenarioResults.runId,
      status: scenarioResults.status,
      n: sql<number>`count(*)::int`,
    })
    .from(scenarioResults)
    .where(inArray(scenarioResults.runId, runIds))
    .groupBy(scenarioResults.runId, scenarioResults.status);
}

export async function runIsActive(db: Db, runId: string): Promise<boolean> {
  const [r] = await db.select({ s: runs.status }).from(runs).where(eq(runs.id, runId));
  return Boolean(r && !TERMINAL_RUN_STATUSES.has(r.s));
}
