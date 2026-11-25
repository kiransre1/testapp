import { z } from "zod";

export const RUN_STATUSES = [
  "queued",
  "preflighting",
  "planning",
  "running",
  "analysing",
  "completed",
  "partial",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  "completed",
  "partial",
  "failed",
  "cancelled",
]);

export const SCENARIO_STATUSES = [
  "pending",
  "running",
  "passed",
  "failed",
  "blocked",
  "skipped",
  "inconclusive",
] as const;
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

export const STEP_STATUSES = ["passed", "failed", "blocked", "skipped", "error"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ["preflighting", "cancelled", "failed"],
  preflighting: ["planning", "running", "failed", "cancelled", "partial"],
  planning: ["running", "failed", "cancelled", "partial"],
  running: ["analysing", "failed", "cancelled", "partial"],
  analysing: ["completed", "partial", "failed", "cancelled"],
  completed: [],
  partial: [],
  failed: [],
  cancelled: [],
};

const SCENARIO_TRANSITIONS: Record<ScenarioStatus, readonly ScenarioStatus[]> = {
  pending: ["running", "skipped", "blocked"],
  running: ["passed", "failed", "blocked", "skipped", "inconclusive"],
  passed: [],
  failed: [],
  blocked: [],
  skipped: [],
  inconclusive: [],
};

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) throw new Error(`illegal run transition ${from} -> ${to}`);
}

export function canTransitionScenario(from: ScenarioStatus, to: ScenarioStatus): boolean {
  return SCENARIO_TRANSITIONS[from].includes(to);
}

export function assertScenarioTransition(from: ScenarioStatus, to: ScenarioStatus): void {
  if (!canTransitionScenario(from, to))
    throw new Error(`illegal scenario transition ${from} -> ${to}`);
}

export const budgetsSchema = z
  .object({
    maxElapsedMinutes: z.number().positive().max(240),
    maxScenarios: z.number().int().positive().max(200),
    maxActionsPerScenario: z.number().int().positive().max(200),
    maxTotalActions: z.number().int().positive().max(5000),
    maxInputTokens: z.number().int().nonnegative().max(5_000_000),
    maxOutputTokens: z.number().int().nonnegative().max(1_000_000),
    maxEstimatedCostUsd: z.number().nonnegative().max(500),
    maxRepeatedActions: z.number().int().positive().max(50),
    maxConsecutiveBlocked: z.number().int().positive().max(50),
  })
  .strict();
export type Budgets = z.infer<typeof budgetsSchema>;

export const BUDGET_NAMES: Record<keyof Budgets, string> = {
  maxElapsedMinutes: "elapsed time",
  maxScenarios: "scenario count",
  maxActionsPerScenario: "actions per scenario",
  maxTotalActions: "total browser actions",
  maxInputTokens: "LLM input tokens",
  maxOutputTokens: "LLM output tokens",
  maxEstimatedCostUsd: "estimated LLM cost",
  maxRepeatedActions: "repeated identical actions",
  maxConsecutiveBlocked: "consecutive blocked actions",
};

export const BROWSER_PROFILES = [
  "chromium-desktop",
  "chromium-mobile",
  "firefox-desktop",
  "webkit-desktop",
] as const;
export type BrowserProfile = (typeof BROWSER_PROFILES)[number];

export const PROFILE_DETAILS: Record<
  BrowserProfile,
  {
    engine: "chromium" | "firefox" | "webkit";
    viewport: { width: number; height: number };
    isMobile: boolean;
  }
> = {
  "chromium-desktop": {
    engine: "chromium",
    viewport: { width: 1366, height: 900 },
    isMobile: false,
  },
  "chromium-mobile": { engine: "chromium", viewport: { width: 390, height: 844 }, isMobile: true },
  "firefox-desktop": { engine: "firefox", viewport: { width: 1366, height: 900 }, isMobile: false },
  "webkit-desktop": { engine: "webkit", viewport: { width: 1366, height: 900 }, isMobile: false },
};

export const runConfigSchema = z
  .object({
    browserProfile: z.enum(BROWSER_PROFILES).default("chromium-desktop"),
    budgets: budgetsSchema,
    /** Restrict to these scenario keys (rerun of individual scenarios). */
    scenarioKeys: z.array(z.string()).max(200).optional(),
    /** Run LLM report analysis (UX/agentic recommendations) after execution. */
    analyse: z.boolean().default(true),
  })
  .strict();
export type RunConfig = z.infer<typeof runConfigSchema>;

export const budgetUsageSchema = z.object({
  elapsedMs: z.number().default(0),
  scenarios: z.number().default(0),
  totalActions: z.number().default(0),
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  estimatedCostUsd: z.number().nullable().default(null),
});
export type BudgetUsage = z.infer<typeof budgetUsageSchema>;
