import {
  type AnalysisInput,
  type AnalysisOutput,
  applyRunPrefix,
  BudgetTracker,
  combineFindings,
  deriveObservedFindings,
  evaluateScenario,
  PROFILE_DETAILS,
  ProviderError,
  type RunStatus,
  redactDeep,
  TERMINAL_RUN_STATUSES,
} from "@testapp/core";
import {
  createScenarioResults,
  getLatestBrief,
  getPlan,
  getPublicTarget,
  getRun,
  getRunDetail,
  isCancelRequested,
  logEvent,
  replaceFindings,
  replaceRecommendations,
  type RunRow,
  schema,
  setRunStatus,
  updateRunUsage,
  updateScenarioResult,
} from "@testapp/db";
import { and, eq } from "drizzle-orm";
import type { Browser } from "playwright";
import type { WorkerContext } from "../context";
import { estimateCostUsd } from "../llm";
import { launchBrowser } from "../runner/browser";
import { performLogin, type StorageState } from "../runner/login";
import { runScenario } from "../runner/scenario";
import { buildAndStoreReports } from "./report";
import { loadCredential, loginConfig, targetPolicy } from "./shared";

/** Called when a run's job lease expired (worker crash/restart). Never re-executes browser actions. */
export async function markRunInterrupted(ctx: WorkerContext, runId: string): Promise<void> {
  const run = await getRun(ctx.db, runId);
  if (!run || TERMINAL_RUN_STATUSES.has(run.status)) return;
  await ctx.db
    .update(schema.scenarioResults)
    .set({
      status: "inconclusive",
      reason: "worker stopped while this scenario was running",
      finishedAt: new Date(),
    })
    .where(
      and(eq(schema.scenarioResults.runId, runId), eq(schema.scenarioResults.status, "running")),
    );
  await ctx.db
    .update(schema.scenarioResults)
    .set({ status: "skipped", reason: "not executed: worker stopped during the run" })
    .where(
      and(eq(schema.scenarioResults.runId, runId), eq(schema.scenarioResults.status, "pending")),
    );
  const to: RunStatus = run.status === "queued" ? "failed" : "partial";
  await setRunStatus(ctx.db, runId, to, {
    statusReason:
      "interrupted: the worker stopped while this run was in progress; completed evidence was preserved",
  });
  await buildAndStoreReports(ctx, runId).catch(() => undefined);
}

export async function handleExecuteRun(
  ctx: WorkerContext,
  payload: Record<string, string>,
): Promise<void> {
  const runId = payload.runId;
  if (!runId) throw new Error("execute_run payload is missing runId");
  let run = await getRun(ctx.db, runId);
  if (!run) throw new Error("run not found");
  if (TERMINAL_RUN_STATUSES.has(run.status)) return;
  if (run.cancelRequested) {
    await setRunStatus(ctx.db, runId, "cancelled", { statusReason: "cancelled before start" });
    return;
  }
  run = await setRunStatus(ctx.db, runId, "preflighting");
  let browser: Browser | null = null;
  try {
    await execute(ctx, run, (b) => {
      browser = b;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message.split("\n")[0]! : String(err);
    const cur = await getRun(ctx.db, runId);
    if (cur && !TERMINAL_RUN_STATUSES.has(cur.status)) {
      await setRunStatus(ctx.db, runId, "failed", { statusReason: `run failed: ${message}` });
      await buildAndStoreReports(ctx, runId).catch(() => undefined);
    }
    throw err;
  } finally {
    await (browser as Browser | null)?.close().catch(() => undefined);
  }
}

async function execute(
  ctx: WorkerContext,
  run: RunRow,
  onBrowser: (b: Browser) => void,
): Promise<void> {
  const runId = run.id;
  const target = await getPublicTarget(ctx.db, run.targetId);
  if (!target) throw new Error("target not found");
  const planData = await getPlan(ctx.db, run.planVersionId);
  if (planData?.plan.status !== "ready") throw new Error("plan is not ready");
  const config = run.config;
  const profile = config.browserProfile;
  const budget = new BudgetTracker(config.budgets);
  const policy = targetPolicy(ctx, target);
  const cred = target.authMode === "form" ? await loadCredential(ctx, target.id) : null;
  const secrets = cred ? [cred.username, cred.password] : [];

  // Select scenarios: enabled ones, optionally restricted to requested keys (individual reruns).
  const selected = planData.scenarios.filter((s) =>
    config.scenarioKeys?.length ? config.scenarioKeys.includes(s.key) : s.enabled,
  );
  if (!selected.length) throw new Error("no enabled scenarios selected");
  const results = await createScenarioResults(
    ctx.db,
    runId,
    selected.map((s, i) => ({ scenarioId: s.id, definition: s.definition, ordinal: i })),
  );

  // Browser + authentication (fails clearly before any expensive work).
  let browser: Browser;
  try {
    browser = await launchBrowser(profile);
  } catch (e) {
    throw new Error(
      `could not launch ${PROFILE_DETAILS[profile].engine}: ${e instanceof Error ? e.message.split("\n")[0] : e}`,
    );
  }
  onBrowser(browser);
  let storageState: StorageState | null = null;
  const lc = loginConfig(target);
  if (lc && selected.some((s) => s.definition.requiresAuth)) {
    if (!cred) throw new Error("form login configured but no credential is stored");
    const login = await performLogin(browser, profile, policy, lc, cred);
    if (!login.ok) throw new Error(`preflight: login could not be verified (${login.detail})`);
    storageState = login.storageState;
  }
  const viewport = PROFILE_DETAILS[profile].viewport;
  await setRunStatus(ctx.db, runId, "running", {
    browser: `${PROFILE_DETAILS[profile].engine} ${browser.version()}`,
    viewport: `${viewport.width}x${viewport.height}${PROFILE_DETAILS[profile].isMobile ? " (mobile)" : ""}`,
  });
  await logEvent(ctx.db, {
    runId,
    type: "run.started",
    message: `executing ${results.length} scenario(s) on ${profile}`,
  });

  let stop:
    | { kind: "budget"; budget: string; message: string }
    | { kind: "cancelled" }
    | { kind: "shutdown" }
    | null = null;
  const actionPolicy = {
    allowDisposableWrites: target.allowDisposableWrites,
    forbiddenSelectors: target.forbiddenSelectors,
    forbiddenRoutes: target.forbiddenRoutes,
    baseUrl: target.baseUrl,
  };

  for (const r of results) {
    const def = r.definition;
    if (stop) {
      await updateScenarioResult(ctx.db, r.id, { status: "skipped", reason: stopReason(stop) });
      continue;
    }
    if (await isCancelRequested(ctx.db, runId)) {
      stop = { kind: "cancelled" };
      await updateScenarioResult(ctx.db, r.id, { status: "skipped", reason: stopReason(stop) });
      continue;
    }
    // Static safety validation: never execute scenarios that violate policy.
    const issues = evaluateScenario(def, actionPolicy, config.budgets.maxActionsPerScenario);
    if (def.blockedReason || issues.length) {
      const why =
        def.blockedReason ??
        issues
          .map((i) => (i.stepIndex === null ? i.reason : `step ${i.stepIndex + 1}: ${i.reason}`))
          .join("; ");
      await updateScenarioResult(ctx.db, r.id, {
        status: "blocked",
        reason: `not executed (safety/plan policy): ${why}`,
      });
      await logEvent(ctx.db, {
        runId,
        level: "warn",
        type: "scenario.policy_blocked",
        message: `${def.key}: ${why}`,
      });
      continue;
    }
    const b = budget.startScenario();
    if (b) {
      stop = { kind: "budget", budget: b.budget, message: b.message };
      await updateScenarioResult(ctx.db, r.id, { status: "skipped", reason: stopReason(stop) });
      continue;
    }
    const outcome = await runScenario({
      ctx,
      runId,
      scenarioResultId: r.id,
      scenario: applyRunPrefix(def, run.runPrefix),
      browser,
      profile,
      policy,
      baseUrl: target.baseUrl,
      storageState,
      credential: cred,
      budget,
      actionPolicy,
      isCancelled: () => isCancelRequested(ctx.db, runId),
    });
    await updateRunUsage(ctx.db, runId, budget.usage());
    if (outcome.runStop) stop = outcome.runStop;
  }

  // Analysis: deterministic observed findings + optional provider recommendations.
  await setRunStatus(ctx.db, runId, "analysing", { budgetUsage: budget.usage() });
  const analysisNote = await analyse(ctx, runId, target.name, budget, config.analyse, secrets);
  if (budget.check() && !stop) stop = { kind: "budget", ...budget.check()! };

  const usage = budget.usage();
  let final: RunStatus = "completed";
  let reason: string | null = null;
  let exhausted: string | null = null;
  if (stop?.kind === "cancelled") {
    final = "cancelled";
    reason = "emergency stop: no further actions were issued; completed evidence was preserved";
  } else if (stop?.kind === "shutdown") {
    final = "partial";
    reason = "worker shut down during the run";
  } else if (stop?.kind === "budget") {
    final = "partial";
    exhausted = stop.budget;
    reason = `${stop.message}; remaining work was skipped. Coverage is incomplete.`;
  }
  await setRunStatus(ctx.db, runId, final, {
    statusReason: [reason, analysisNote].filter(Boolean).join(" ") || null,
    budgetExhausted: exhausted,
    budgetUsage: usage,
  });
  await buildAndStoreReports(ctx, runId);
}

function stopReason(stop: { kind: string; message?: string }): string {
  if (stop.kind === "cancelled") return "not executed: run was cancelled (emergency stop)";
  if (stop.kind === "shutdown") return "not executed: worker shut down";
  return `not executed: ${stop.message}`;
}

async function analyse(
  ctx: WorkerContext,
  runId: string,
  targetName: string,
  budget: BudgetTracker,
  useProvider: boolean,
  secrets: string[],
): Promise<string | null> {
  const detail = await getRunDetail(ctx.db, runId);
  if (!detail) return null;
  const run = detail.run;
  const stepArtifacts: Record<string, { id: string; kind: string }[]> = {};
  for (const a of detail.artifacts) {
    if (!a.stepResultId) continue;
    const list = stepArtifacts[a.stepResultId] ?? [];
    list.push({ id: a.id, kind: a.kind });
    stepArtifacts[a.stepResultId] = list;
  }
  const observed = deriveObservedFindings({
    runPrefix: run.runPrefix,
    targetVersion: run.targetBuildLabel,
    browser: run.browser ?? run.config.browserProfile,
    viewport: run.viewport ?? "",
    scenarios: detail.scenarios.map((s) => ({
      id: s.id,
      key: s.scenarioKey,
      status: s.status,
      reason: s.reason,
      definition: s.definition,
      steps: detail.steps
        .filter((st) => st.scenarioResultId === s.id)
        .map((st) => ({
          id: st.id,
          index: st.index,
          action: st.action,
          description: st.description,
          status: st.status,
          expected: st.expected,
          actual: st.actual,
          error: st.error,
          url: st.url,
          details: st.details,
        })),
      events: s.browserEvents,
      stepArtifacts,
      scenarioArtifacts: detail.artifacts
        .filter((a) => a.scenarioResultId === s.id && !a.stepResultId)
        .map((a) => ({ id: a.id, kind: a.kind })),
    })),
  });

  let analysis: AnalysisOutput | null = null;
  let note: string | null = null;
  if (useProvider) {
    const brief = await getLatestBrief(ctx.db, run.targetId);
    const plan = detail.plan;
    const axeRules = new Map<string, { id: string; impact: string; help: string; count: number }>();
    for (const st of detail.steps) {
      const axe = st.details?.axe as
        | { id: string; impact: string; help: string; count: number }[]
        | undefined;
      for (const v of axe ?? []) {
        const cur = axeRules.get(v.id);
        axeRules.set(v.id, { ...v, count: (cur?.count ?? 0) + v.count });
      }
    }
    const input: AnalysisInput = redactDeep(
      {
        brief: brief?.content ?? "",
        targetName,
        scenarios: detail.scenarios.map((s) => ({
          key: s.scenarioKey,
          title: s.title,
          riskArea: s.definition.riskArea,
          journeyKey: s.definition.journeyKey,
          status: s.status,
          reason: s.reason,
        })),
        observedFindings: observed.map((f) => ({
          key: f.key,
          category: f.category,
          title: f.title,
          scenarioKey: f.scenarioKey,
          actual: f.actual,
        })),
        accessibilityRules: [...axeRules.values()],
        runtimeSymptoms: observed
          .filter((f) => f.category === "observed_runtime_symptom")
          .map((f) => f.title),
        coverageGaps: [
          ...plan.coverage
            .filter((c) => c.status === "unsupported" || c.status === "not_covered")
            .map((c) => `${c.area}: ${c.notes}`),
          ...detail.scenarios
            .filter((s) => ["blocked", "skipped", "inconclusive"].includes(s.status))
            .map((s) => `${s.scenarioKey} ${s.title} (${s.status})`),
        ],
      },
      secrets,
    );
    try {
      const res = await ctx.provider.analyseRun(input, budget.remainingTokens());
      budget.recordUsage(
        res.usage.inputTokens,
        res.usage.outputTokens,
        estimateCostUsd(ctx.env, res.usage.inputTokens, res.usage.outputTokens),
      );
      analysis = res.data;
      await ctx.db
        .update(schema.runs)
        .set({ analysisSummary: res.data.summary })
        .where(eq(schema.runs.id, runId));
    } catch (e) {
      note =
        e instanceof ProviderError
          ? `Recommendation analysis unavailable (${e.kind}: ${e.message}); observed findings are unaffected.`
          : "Recommendation analysis failed; observed findings are unaffected.";
      await logEvent(ctx.db, { runId, level: "warn", type: "analysis.failed", message: note });
    }
  } else {
    note = "Recommendation analysis was disabled for this run.";
  }
  const all = combineFindings(observed, analysis);
  await replaceFindings(ctx.db, runId, redactDeep(all, secrets));
  await replaceRecommendations(ctx.db, runId, [
    ...(analysis?.uxRecommendations ?? []).map((d) => ({ kind: "ux" as const, data: d })),
    ...(analysis?.agenticOpportunities ?? []).map((d) => ({ kind: "agentic" as const, data: d })),
  ]);
  return note;
}
