import { BUDGET_NAMES, type BudgetUsage, type Budgets } from "./schemas/run";

export type BudgetExhaustion = { budget: keyof Budgets; message: string };

/**
 * Deterministic run budget enforcement. Time and action limits are checked
 * before every browser action; token limits use provider-reported usage plus
 * reservations; cost is only computed when pricing is configured.
 */
export class BudgetTracker {
  private totalActions = 0;
  private scenarios = 0;
  private scenarioActions = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private cost: number | null = 0;
  private consecutiveBlocked = 0;
  private lastSignature: string | null = null;
  private repeatCount = 0;

  constructor(
    readonly budgets: Budgets,
    private readonly startedAt: number = Date.now(),
    private readonly now: () => number = Date.now,
  ) {}

  elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  remainingMs(): number {
    return Math.max(0, this.budgets.maxElapsedMinutes * 60_000 - this.elapsedMs());
  }

  /** Check run-level budgets before starting new work. */
  check(): BudgetExhaustion | null {
    if (this.elapsedMs() >= this.budgets.maxElapsedMinutes * 60_000)
      return this.ex("maxElapsedMinutes");
    if (this.totalActions >= this.budgets.maxTotalActions) return this.ex("maxTotalActions");
    if (this.inputTokens >= this.budgets.maxInputTokens && this.budgets.maxInputTokens > 0)
      return this.ex("maxInputTokens");
    if (this.outputTokens >= this.budgets.maxOutputTokens && this.budgets.maxOutputTokens > 0)
      return this.ex("maxOutputTokens");
    if (
      this.cost !== null &&
      this.cost >= this.budgets.maxEstimatedCostUsd &&
      this.budgets.maxEstimatedCostUsd > 0
    ) {
      return this.ex("maxEstimatedCostUsd");
    }
    if (this.consecutiveBlocked >= this.budgets.maxConsecutiveBlocked)
      return this.ex("maxConsecutiveBlocked");
    return null;
  }

  /** Call before starting a scenario. */
  startScenario(): BudgetExhaustion | null {
    const e = this.check();
    if (e) return e;
    if (this.scenarios >= this.budgets.maxScenarios) return this.ex("maxScenarios");
    this.scenarios++;
    this.scenarioActions = 0;
    this.lastSignature = null;
    this.repeatCount = 0;
    return null;
  }

  /**
   * Call before each browser action. Returns a run-level exhaustion, or a
   * scenario-level stop (per-scenario cap or loop) with scope "scenario".
   */
  beforeAction(signature: string): (BudgetExhaustion & { scope: "run" | "scenario" }) | null {
    const e = this.check();
    if (e) return { ...e, scope: "run" };
    if (this.scenarioActions >= this.budgets.maxActionsPerScenario)
      return { ...this.ex("maxActionsPerScenario"), scope: "scenario" };
    if (signature === this.lastSignature) {
      this.repeatCount++;
    } else {
      this.lastSignature = signature;
      this.repeatCount = 1;
    }
    if (this.repeatCount > this.budgets.maxRepeatedActions) {
      return {
        budget: "maxRepeatedActions",
        message: `loop detected: the same action repeated ${this.repeatCount} times`,
        scope: "scenario",
      };
    }
    this.totalActions++;
    this.scenarioActions++;
    return null;
  }

  recordStepOutcome(blocked: boolean): void {
    this.consecutiveBlocked = blocked ? this.consecutiveBlocked + 1 : 0;
  }

  /** Reserve tokens before a provider call; returns false if the reservation cannot fit. */
  canReserve(inputTokens: number, outputTokens: number): boolean {
    return (
      this.inputTokens + inputTokens <= this.budgets.maxInputTokens &&
      this.outputTokens + outputTokens <= this.budgets.maxOutputTokens
    );
  }

  remainingTokens(): { remainingInputTokens: number; remainingOutputTokens: number } {
    return {
      remainingInputTokens: Math.max(0, this.budgets.maxInputTokens - this.inputTokens),
      remainingOutputTokens: Math.max(0, this.budgets.maxOutputTokens - this.outputTokens),
    };
  }

  recordUsage(inputTokens: number, outputTokens: number, costUsd: number | null): void {
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
    this.cost = costUsd === null || this.cost === null ? null : this.cost + costUsd;
  }

  usage(): BudgetUsage {
    return {
      elapsedMs: this.elapsedMs(),
      scenarios: this.scenarios,
      totalActions: this.totalActions,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      estimatedCostUsd: this.cost,
    };
  }

  private ex(budget: keyof Budgets): BudgetExhaustion {
    return {
      budget,
      message: `${BUDGET_NAMES[budget]} budget reached (limit ${this.budgets[budget]})`,
    };
  }
}

/** Replace the {{run}} token in every string of a JSON value. */
export function applyRunPrefix<T>(value: T, runPrefix: string): T {
  if (typeof value === "string") return value.replaceAll("{{run}}", runPrefix) as T;
  if (Array.isArray(value)) return value.map((v) => applyRunPrefix(v, runPrefix)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[k] = applyRunPrefix(v, runPrefix);
    return out as T;
  }
  return value;
}

export function makeRunPrefix(random: () => number = Math.random): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(random() * alphabet.length)];
  return `TA-${s}`;
}
