import { describe, expect, it } from "vitest";
import { applyRunPrefix, BudgetTracker, makeRunPrefix } from "../src/budget";
import {
  assertRunTransition,
  assertScenarioTransition,
  type Budgets,
  canTransitionRun,
  canTransitionScenario,
} from "../src/schemas/run";

const budgets: Budgets = {
  maxElapsedMinutes: 1,
  maxScenarios: 2,
  maxActionsPerScenario: 3,
  maxTotalActions: 5,
  maxInputTokens: 1000,
  maxOutputTokens: 500,
  maxEstimatedCostUsd: 1,
  maxRepeatedActions: 2,
  maxConsecutiveBlocked: 2,
};

describe("budgets", () => {
  it("enforces scenario count and per-scenario action caps", () => {
    const b = new BudgetTracker(budgets);
    expect(b.startScenario()).toBeNull();
    expect(b.beforeAction("a")).toBeNull();
    expect(b.beforeAction("b")).toBeNull();
    expect(b.beforeAction("c")).toBeNull();
    expect(b.beforeAction("d")).toMatchObject({
      budget: "maxActionsPerScenario",
      scope: "scenario",
    });
    expect(b.startScenario()).toBeNull();
    expect(b.startScenario()).toMatchObject({ budget: "maxScenarios" });
  });

  it("enforces total actions at run scope", () => {
    const b = new BudgetTracker({ ...budgets, maxActionsPerScenario: 10, maxScenarios: 5 });
    b.startScenario();
    for (let i = 0; i < 5; i++) expect(b.beforeAction(`x${i}`)).toBeNull();
    expect(b.beforeAction("y")).toMatchObject({ budget: "maxTotalActions", scope: "run" });
    expect(b.usage().totalActions).toBe(5);
  });

  it("enforces elapsed time deterministically with an injected clock", () => {
    let now = 0;
    const b = new BudgetTracker(budgets, 0, () => now);
    expect(b.check()).toBeNull();
    now = 61_000;
    expect(b.check()).toMatchObject({ budget: "maxElapsedMinutes" });
    expect(b.remainingMs()).toBe(0);
  });

  it("detects loops of identical actions", () => {
    const b = new BudgetTracker({ ...budgets, maxActionsPerScenario: 10, maxTotalActions: 10 });
    b.startScenario();
    expect(b.beforeAction("same")).toBeNull();
    expect(b.beforeAction("same")).toBeNull();
    expect(b.beforeAction("same")).toMatchObject({
      budget: "maxRepeatedActions",
      scope: "scenario",
    });
  });

  it("stops after consecutive blocked actions and resets on success", () => {
    const b = new BudgetTracker(budgets);
    b.recordStepOutcome(true);
    b.recordStepOutcome(false);
    b.recordStepOutcome(true);
    expect(b.check()).toBeNull();
    b.recordStepOutcome(true);
    expect(b.check()).toMatchObject({ budget: "maxConsecutiveBlocked" });
  });

  it("tracks tokens and cost; unknown pricing makes cost null without disabling token caps", () => {
    const b = new BudgetTracker(budgets);
    expect(b.canReserve(900, 100)).toBe(true);
    b.recordUsage(600, 100, 0.2);
    expect(b.canReserve(500, 0)).toBe(false);
    b.recordUsage(400, 0, null);
    expect(b.usage().estimatedCostUsd).toBeNull();
    expect(b.check()).toMatchObject({ budget: "maxInputTokens" });
  });

  it("stops on estimated cost when pricing is known", () => {
    const b = new BudgetTracker({ ...budgets, maxInputTokens: 1e9, maxOutputTokens: 1e9 });
    b.recordUsage(1, 1, 1.5);
    expect(b.check()).toMatchObject({ budget: "maxEstimatedCostUsd" });
  });
});

describe("run prefix templating", () => {
  it("replaces {{run}} everywhere and generates readable prefixes", () => {
    const p = makeRunPrefix(() => 0);
    expect(p).toMatch(/^TA-[A-Z2-9]{6}$/);
    expect(applyRunPrefix({ a: "{{run}} x", b: ["{{run}}"], c: 1 }, "TA-AAAAAA")).toEqual({
      a: "TA-AAAAAA x",
      b: ["TA-AAAAAA"],
      c: 1,
    });
  });
});

describe("state machines", () => {
  it("allows the documented run lifecycle and forbids leaving terminal states", () => {
    for (const [a, b] of [
      ["queued", "preflighting"],
      ["preflighting", "running"],
      ["running", "analysing"],
      ["analysing", "completed"],
      ["analysing", "partial"],
      ["running", "cancelled"],
      ["queued", "cancelled"],
    ] as const) {
      expect(canTransitionRun(a, b), `${a}->${b}`).toBe(true);
    }
    for (const [a, b] of [
      ["completed", "running"],
      ["failed", "queued"],
      ["queued", "completed"],
      ["cancelled", "analysing"],
    ] as const) {
      expect(canTransitionRun(a, b), `${a}->${b}`).toBe(false);
    }
    expect(() => assertRunTransition("completed", "running")).toThrow(/illegal/);
  });

  it("allows scenario transitions only from pending/running", () => {
    expect(canTransitionScenario("pending", "running")).toBe(true);
    expect(canTransitionScenario("running", "inconclusive")).toBe(true);
    expect(canTransitionScenario("pending", "skipped")).toBe(true);
    expect(canTransitionScenario("passed", "failed")).toBe(false);
    expect(() => assertScenarioTransition("failed", "passed")).toThrow();
  });
});
