import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import {
  type Action,
  type ActionPolicyContext,
  ASSERTION_ACTIONS,
  type BrowserProfile,
  type BudgetExhaustion,
  type BudgetTracker,
  describeAction,
  evaluateAction,
  evaluateInteractionText,
  locatorText,
  PROFILE_DETAILS,
  redactDeep,
  redactSecrets,
  sanitizeUrl,
  type Scenario,
  type ScenarioStatus,
  type StepStatus,
  truncate,
} from "@testapp/core";
import { type BrowserEvent, insertStepResult, updateScenarioResult } from "@testapp/db";
import type { Browser, Locator, Page } from "playwright";
import type { WorkerContext } from "../context";
import { newPolicyContext, safeScreenshot, type TargetPolicy } from "./browser";
import { saveArtifact } from "./evidence";
import { describeElement, resolveSingle, toPlaywrightLocator } from "./locate";
import type { StorageState } from "./login";

export type ScenarioRunInput = {
  ctx: WorkerContext;
  runId: string;
  scenarioResultId: string;
  /** Already templated with the run prefix. */
  scenario: Scenario;
  browser: Browser;
  profile: BrowserProfile;
  policy: TargetPolicy;
  baseUrl: string;
  storageState: StorageState | null;
  credential: { username: string; password: string } | null;
  budget: BudgetTracker;
  actionPolicy: Omit<ActionPolicyContext, "scenarioDataMode">;
  isCancelled: () => Promise<boolean>;
};

export type ScenarioRunOutcome = {
  status: ScenarioStatus;
  reason: string | null;
  actionCount: number;
  runStop:
    | (BudgetExhaustion & { kind: "budget" })
    | { kind: "cancelled" }
    | { kind: "shutdown" }
    | null;
};

type StepOutcome = {
  status: StepStatus;
  expected?: string;
  actual?: string;
  error?: string;
  details?: Record<string, unknown>;
  artifactLabel?: string;
};

const ASSERT_TIMEOUT = 5_000;
const MAX_EVENTS = 200;

async function poll(
  fn: () => Promise<boolean>,
  timeoutMs = ASSERT_TIMEOUT,
  page?: Page,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn().catch(() => false)) return true;
    if (Date.now() >= deadline) return false;
    if (page) await page.waitForTimeout(200);
    else await new Promise((r) => setTimeout(r, 200));
  }
}

function withoutKey(o: Record<string, unknown>, key: string): Record<string, unknown> {
  const { [key]: _omit, ...rest } = o;
  return rest;
}

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return truncate(msg.split("\n")[0] ?? msg, 300);
}

export async function runScenario(input: ScenarioRunInput): Promise<ScenarioRunOutcome> {
  const { ctx, scenario, budget } = input;
  const secrets = input.credential ? [input.credential.username, input.credential.password] : [];
  const redact = <T>(v: T): T => redactDeep(v, secrets);
  const started = Date.now();
  await updateScenarioResult(ctx.db, input.scenarioResultId, {
    status: "running",
    startedAt: new Date(),
  });

  const handlesSecrets = scenario.steps.some(
    (s) => s.action === "fill" && typeof s.value !== "string",
  );
  const { context, blocked } = await newPolicyContext(input.browser, input.profile, input.policy, {
    storageState: scenario.requiresAuth ? (input.storageState ?? undefined) : undefined,
  });
  // Failure-oriented trace retention; never trace scenarios that type credentials.
  const tracing = !handlesSecrets;
  if (tracing) await context.tracing.start({ screenshots: true, snapshots: true, sources: false });

  const events: BrowserEvent[] = [];
  let currentStep = -1;
  const pushEvent = (e: Omit<BrowserEvent, "at">) => {
    if (events.length < MAX_EVENTS)
      events.push(
        redact({
          ...e,
          message: truncate(e.message, 500),
          at: new Date().toISOString(),
          step: currentStep,
        } as BrowserEvent),
      );
  };
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error")
      pushEvent({ type: "console", message: m.text(), url: sanitizeUrl(page.url()) });
  });
  page.on("pageerror", (err) =>
    pushEvent({
      type: "page_error",
      message: `${err.name}: ${err.message}`,
      url: sanitizeUrl(page.url()),
    }),
  );
  page.on("requestfailed", (req) => {
    const f = req.failure()?.errorText ?? "failed";
    if (/BLOCKED_BY_CLIENT|NS_ERROR_ABORT|cancelled/i.test(f)) return; // policy blocks are recorded separately
    pushEvent({
      type: "network",
      message: `request failed: ${f}`,
      url: sanitizeUrl(req.url()),
      method: req.method(),
    });
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      pushEvent({
        type: "network",
        message: `HTTP ${res.status()}`,
        url: sanitizeUrl(res.url()),
        status: res.status(),
        method: res.request().method(),
      });
    }
  });

  let status: ScenarioStatus = "passed";
  let reason: string | null = null;
  let runStop: ScenarioRunOutcome["runStop"] = null;
  let anyFailed = false;
  let actionCount = 0;
  let lastShotIndex = -2;

  const actionCtx: ActionPolicyContext = {
    ...input.actionPolicy,
    scenarioDataMode: scenario.dataMode,
  };

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i]!;
    currentStep = i;
    if (ctx.shuttingDown()) {
      runStop = { kind: "shutdown" };
      status = anyFailed ? "failed" : "inconclusive";
      reason = "worker shutting down";
      break;
    }
    if (await input.isCancelled()) {
      runStop = { kind: "cancelled" };
      status = anyFailed ? "failed" : "skipped";
      reason = "run cancelled (emergency stop) before this step";
      break;
    }
    const b = budget.beforeAction(JSON.stringify(step));
    if (b) {
      if (b.scope === "run") runStop = { kind: "budget", budget: b.budget, message: b.message };
      status = anyFailed ? "failed" : "inconclusive";
      reason = b.message;
      break;
    }
    actionCount++;
    const t0 = Date.now();
    const blockedBefore = blocked.length;
    let outcome: StepOutcome;
    const staticDecision = evaluateAction(step, actionCtx);
    if (!staticDecision.allowed) {
      outcome = {
        status: "blocked",
        error: `policy: ${staticDecision.reason}`,
        details: { policyCode: staticDecision.code },
      };
    } else {
      try {
        outcome = await executeStep(page, step, input, actionCtx);
      } catch (err) {
        outcome = { status: "error", error: errorText(err) };
      }
      if (blocked.length > blockedBefore) {
        const b0 = blocked[blockedBefore]!;
        outcome = {
          status: "blocked",
          error: `navigation blocked by origin policy: ${b0.reason}`,
          details: { ...(outcome.details ?? {}), blockedNavigation: b0 },
        };
      }
    }
    budget.recordStepOutcome(outcome.status === "blocked");
    const stepRow = await insertStepResult(ctx.db, {
      runId: input.runId,
      scenarioResultId: input.scenarioResultId,
      index: i,
      action: step.action,
      description: redactSecrets(step.description ?? describeAction(step), secrets),
      status: outcome.status,
      expected: outcome.expected ? redactSecrets(outcome.expected, secrets) : null,
      actual: outcome.actual ? redactSecrets(truncate(outcome.actual, 1000), secrets) : null,
      error: outcome.error ? redactSecrets(outcome.error, secrets) : null,
      url: sanitizeUrl(page.url()),
      durationMs: Date.now() - t0,
      details: outcome.details ? redact(withoutKey(outcome.details, "axeReport")) : null,
    });
    // Evidence: screenshot on failure/blockage/error, on explicit screenshot steps.
    if (outcome.status !== "passed" || step.action === "screenshot") {
      const shot = await safeScreenshot(page);
      if (shot) {
        await saveArtifact(ctx, {
          kind: "screenshot",
          label:
            step.action === "screenshot"
              ? step.label
              : `${scenario.key} step ${i + 1} ${outcome.status}`,
          data: shot,
          runId: input.runId,
          scenarioResultId: input.scenarioResultId,
          stepResultId: stepRow.id,
        });
        lastShotIndex = i;
      }
    }
    if (outcome.details?.axeReport) {
      await saveArtifact(ctx, {
        kind: "axe",
        label: `${scenario.key} accessibility (${step.action === "runAccessibilityCheck" ? (step.label ?? "page") : "page"})`,
        data: Buffer.from(JSON.stringify(redact(outcome.details.axeReport), null, 2)),
        runId: input.runId,
        scenarioResultId: input.scenarioResultId,
        stepResultId: stepRow.id,
      });
    }
    if (outcome.status === "failed") {
      anyFailed = true;
      if (!reason)
        reason = `step ${i + 1} failed: ${outcome.error ?? outcome.actual ?? "assertion failed"}`;
      continue; // soft assertions: keep collecting evidence
    }
    if (outcome.status === "blocked") {
      status = anyFailed ? "failed" : "blocked";
      reason = reason ?? `step ${i + 1} blocked: ${outcome.error ?? "automation blocked"}`;
      break;
    }
    if (outcome.status === "error") {
      status = anyFailed ? "failed" : "inconclusive";
      reason =
        reason ??
        `step ${i + 1} could not complete: ${outcome.error ?? "error"} (possible defect or environment issue; low confidence)`;
      break;
    }
  }
  if (status === "passed" && anyFailed) status = "failed";

  // Final-state screenshot if the last step was not already captured.
  if (lastShotIndex !== scenario.steps.length - 1 && !page.isClosed()) {
    const shot = await safeScreenshot(page);
    if (shot) {
      await saveArtifact(ctx, {
        kind: "screenshot",
        label: `${scenario.key} final state (${status})`,
        data: shot,
        runId: input.runId,
        scenarioResultId: input.scenarioResultId,
      });
    }
  }
  for (const b of blocked) pushEvent({ type: "blocked_navigation", message: b.reason, url: b.url });

  if (tracing) {
    const keep = status !== "passed";
    if (keep) {
      const file = path.join(tmpdir(), `trace-${input.scenarioResultId}.zip`);
      try {
        await context.tracing.stop({ path: file });
        await saveArtifact(ctx, {
          kind: "trace",
          label: `${scenario.key} Playwright trace (${status})`,
          data: await readFile(file),
          runId: input.runId,
          scenarioResultId: input.scenarioResultId,
        });
      } catch {
        /* trace capture is best-effort */
      } finally {
        await rm(file, { force: true });
      }
    } else {
      await context.tracing.stop().catch(() => undefined);
    }
  }
  if (events.length) {
    await saveArtifact(ctx, {
      kind: "console_log",
      label: `${scenario.key} browser events`,
      data: Buffer.from(JSON.stringify(events, null, 2)),
      runId: input.runId,
      scenarioResultId: input.scenarioResultId,
    });
  }
  await context.close().catch(() => undefined);
  await updateScenarioResult(ctx.db, input.scenarioResultId, {
    status,
    reason: reason ? redactSecrets(reason, secrets) : null,
    actionCount,
    browserEvents: events,
    finishedAt: new Date(),
    durationMs: Date.now() - started,
  });
  return { status, reason, actionCount, runStop };
}

async function interact(
  page: Page,
  l: Parameters<typeof resolveSingle>[1],
  actionCtx: ActionPolicyContext,
  checkPolicy: boolean,
): Promise<{ ok: true; el: Locator } | { ok: false; out: StepOutcome }> {
  const r = await resolveSingle(page, l);
  if (!r.ok) {
    const msg =
      r.reason === "ambiguous"
        ? `locator is ambiguous (${r.count} matches); add nth or a more specific locator`
        : r.reason === "not_visible"
          ? "element exists but is not visible"
          : "element not found";
    return {
      ok: false,
      out: {
        status: "blocked",
        error: `automation blocked: ${msg}`,
        details: { locator: l, matches: r.count },
      },
    };
  }
  if (checkPolicy) {
    const live = (await describeElement(r.locator)) || locatorText(l);
    const d = evaluateInteractionText(live, actionCtx);
    if (!d.allowed)
      return {
        ok: false,
        out: {
          status: "blocked",
          error: `policy (live element): ${d.reason}`,
          details: { policyCode: d.code },
        },
      };
  }
  return { ok: true, el: r.locator };
}

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
}

async function executeStep(
  page: Page,
  step: Action,
  input: ScenarioRunInput,
  actionCtx: ActionPolicyContext,
): Promise<StepOutcome> {
  switch (step.action) {
    case "navigate": {
      const url = new URL(step.target, input.baseUrl).toString();
      const res = await page.goto(url, { waitUntil: "domcontentloaded" });
      const h = res ? await res.allHeaders().catch(() => ({}) as Record<string, string>) : null;
      const csp = h?.["content-security-policy"] ?? "";
      return {
        status: "passed",
        details: {
          httpStatus: res?.status() ?? null,
          url: sanitizeUrl(page.url()),
          // Passive header observation only (no probing).
          securityHeaders: h
            ? {
                csp: Boolean(csp),
                xcto: (h["x-content-type-options"] ?? "").toLowerCase() === "nosniff",
                frameProtection: Boolean(h["x-frame-options"]) || csp.includes("frame-ancestors"),
                hsts: Boolean(h["strict-transport-security"]),
              }
            : undefined,
        },
      };
    }
    case "reload": {
      const res = await page.reload({ waitUntil: "domcontentloaded" });
      return { status: "passed", details: { httpStatus: res?.status() ?? null } };
    }
    case "click": {
      const r = await interact(page, step.locator, actionCtx, true);
      if (!r.ok) return r.out;
      try {
        await r.el.click({ timeout: 8_000 });
      } catch (err) {
        return { status: "blocked", error: `automation blocked: click failed (${errorText(err)})` };
      }
      await settle(page);
      return { status: "passed" };
    }
    case "fill": {
      const r = await interact(page, step.locator, actionCtx, false);
      if (!r.ok) return r.out;
      let value: string;
      let shown: string;
      if (typeof step.value === "string") {
        value = step.value;
        shown = step.value;
      } else {
        const cred = input.credential;
        if (!cred)
          return {
            status: "blocked",
            error: "scenario references a secret but no credential is configured",
          };
        value = cred[step.value.secretRef];
        shown = `‹secret:${step.value.secretRef}›`;
      }
      await r.el.fill(value, { timeout: 8_000 });
      return { status: "passed", details: { value: shown } };
    }
    case "select": {
      const r = await interact(page, step.locator, actionCtx, false);
      if (!r.ok) return r.out;
      const d = evaluateInteractionText(step.option, actionCtx);
      if (!d.allowed) return { status: "blocked", error: `policy: ${d.reason}` };
      await r.el
        .selectOption({ label: step.option }, { timeout: 8_000 })
        .catch(() => r.el.selectOption(step.option, { timeout: 8_000 }));
      await settle(page);
      return { status: "passed" };
    }
    case "check": {
      const r = await interact(page, step.locator, actionCtx, true);
      if (!r.ok) return r.out;
      await r.el.setChecked(step.checked, { timeout: 8_000 });
      return { status: "passed" };
    }
    case "press": {
      if (step.locator) {
        const r = await interact(page, step.locator, actionCtx, step.key === "Enter");
        if (!r.ok) return r.out;
        await r.el.press(step.key, { timeout: 8_000 });
      } else {
        await page.keyboard.press(step.key);
      }
      await settle(page);
      return { status: "passed" };
    }
    case "waitFor": {
      try {
        if (step.locator) {
          await toPlaywrightLocator(page, step.locator)
            .first()
            .waitFor({ state: step.state, timeout: step.timeoutMs });
        } else if (step.urlContains) {
          const needle = step.urlContains;
          await page.waitForURL((u) => u.toString().includes(needle), { timeout: step.timeoutMs });
        }
        return { status: "passed" };
      } catch {
        return {
          status: "error",
          error: `timed out after ${step.timeoutMs}ms waiting for the condition`,
        };
      }
    }
    case "assertVisible": {
      const loc = toPlaywrightLocator(page, step.locator).first();
      const ok = await poll(
        async () => (step.visible ? loc.isVisible() : !(await loc.isVisible())),
        ASSERT_TIMEOUT,
        page,
      );
      if (ok)
        return {
          status: "passed",
          expected: step.visible ? "visible" : "hidden",
          actual: step.visible ? "visible" : "hidden",
        };
      const count = await toPlaywrightLocator(page, step.locator)
        .count()
        .catch(() => 0);
      return {
        status: "failed",
        expected: `${locatorText(step.locator) || step.locator.by} is ${step.visible ? "visible" : "hidden"}`,
        actual: step.visible
          ? count === 0
            ? "no matching element on the page"
            : `${count} matching element(s), none visible`
          : "element is visible",
        details: { matches: count, assertion: true },
      };
    }
    case "assertText": {
      const loc = toPlaywrightLocator(page, step.locator).first();
      let last = "";
      const ok = await poll(
        async () => {
          last = ((await loc.textContent({ timeout: 1_000 })) ?? "").replace(/\s+/g, " ").trim();
          return step.match === "equals" ? last === step.text : last.includes(step.text);
        },
        ASSERT_TIMEOUT,
        page,
      );
      if (ok) return { status: "passed", expected: step.text, actual: last };
      const count = await toPlaywrightLocator(page, step.locator)
        .count()
        .catch(() => 0);
      return {
        status: "failed",
        expected: `${step.match === "equals" ? "text equal to" : "text containing"} "${step.text}"`,
        actual: count === 0 ? "no matching element on the page" : `"${truncate(last, 300)}"`,
        details: { matches: count, assertion: true },
      };
    }
    case "assertUrl": {
      const check = () => {
        const u = new URL(page.url());
        return step.pathEquals
          ? u.pathname === step.pathEquals
          : u.toString().includes(step.contains ?? "");
      };
      const ok = await poll(async () => check(), ASSERT_TIMEOUT, page);
      const actual = sanitizeUrl(page.url());
      return ok
        ? { status: "passed", expected: step.pathEquals ?? step.contains, actual }
        : {
            status: "failed",
            expected: step.pathEquals
              ? `path ${step.pathEquals}`
              : `URL containing "${step.contains}"`,
            actual,
            details: { assertion: true },
          };
    }
    case "assertCount": {
      const loc = toPlaywrightLocator(page, step.locator);
      let n = 0;
      const cmp = (x: number) =>
        step.comparison === "eq"
          ? x === step.count
          : step.comparison === "gte"
            ? x >= step.count
            : x <= step.count;
      const ok = await poll(
        async () => {
          n = await loc.count();
          return cmp(n);
        },
        ASSERT_TIMEOUT,
        page,
      );
      const expected = `count ${{ eq: "=", gte: "≥", lte: "≤" }[step.comparison]} ${step.count}`;
      return ok
        ? { status: "passed", expected, actual: String(n) }
        : { status: "failed", expected, actual: String(n), details: { assertion: true } };
    }
    case "runAccessibilityCheck": {
      let builder = new AxeBuilder({ page }).withTags([
        "wcag2a",
        "wcag2aa",
        "wcag21a",
        "wcag21aa",
        "wcag22aa",
      ]);
      if (step.include) builder = builder.include(step.include);
      const results = await builder.analyze();
      const violations = results.violations.map((v) => ({
        id: v.id,
        impact: v.impact ?? "unknown",
        help: v.help,
        helpUrl: v.helpUrl,
        tags: v.tags,
        nodes: v.nodes.slice(0, 20).map((n) => ({
          target: n.target.map(String),
          html: truncate(n.html, 300),
          failureSummary: truncate(n.failureSummary ?? "", 500),
        })),
        nodeCount: v.nodes.length,
      }));
      const summary = violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        count: v.nodeCount,
        tags: v.tags.filter((t) => t.startsWith("wcag")),
      }));
      const axeReport = {
        url: sanitizeUrl(page.url()),
        engine: `axe-core ${results.testEngine.version}`,
        profile: input.profile,
        viewport: PROFILE_DETAILS[input.profile].viewport,
        violations,
        passes: results.passes.length,
        incomplete: results.incomplete.map((i) => ({
          id: i.id,
          help: i.help,
          count: i.nodes.length,
        })),
        note: "Automated rule results only. They do not establish WCAG conformance or non-conformance.",
      };
      return violations.length
        ? {
            status: "failed",
            expected: "no automated accessibility rule violations",
            actual: `${violations.length} rule(s) violated: ${violations.map((v) => v.id).join(", ")}`,
            details: { axe: summary, axeReport, automatedCheck: true },
          }
        : {
            status: "passed",
            expected: "no automated accessibility rule violations",
            actual: "0 violations",
            details: { axe: [], axeReport, automatedCheck: true },
          };
    }
    case "screenshot":
      return { status: "passed" };
  }
}

export const isAssertion = (a: Action) => ASSERTION_ACTIONS.has(a.action);
