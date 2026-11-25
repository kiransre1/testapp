import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  AgenticRecommendation,
  BudgetUsage,
  CoverageRow,
  EvidenceRef,
  Journey,
  Locator,
  Persona,
  RunConfig,
  Scenario,
  StandardRef,
  UxRecommendation,
} from "@testapp/core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

export const runStatusEnum = pgEnum("run_status", [
  "queued",
  "preflighting",
  "planning",
  "running",
  "analysing",
  "completed",
  "partial",
  "failed",
  "cancelled",
]);
export const scenarioStatusEnum = pgEnum("scenario_status", [
  "pending",
  "running",
  "passed",
  "failed",
  "blocked",
  "skipped",
  "inconclusive",
]);
export const stepStatusEnum = pgEnum("step_status", [
  "passed",
  "failed",
  "blocked",
  "skipped",
  "error",
]);
export const jobKindEnum = pgEnum("job_kind", ["preflight", "generate_plan", "execute_run"]);
export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export const authModeEnum = pgEnum("auth_mode", ["none", "form"]);
export const planStatusEnum = pgEnum("plan_status", ["generating", "ready", "failed"]);
export const preflightStatusEnum = pgEnum("preflight_status", [
  "queued",
  "running",
  "passed",
  "failed",
]);
export const findingCategoryEnum = pgEnum("finding_category", [
  "observed_failure",
  "observed_runtime_symptom",
  "automated_standard_result",
  "heuristic_observation",
  "inferred_risk",
  "enhancement_opportunity",
]);
export const severityEnum = pgEnum("severity", ["critical", "high", "medium", "low", "info"]);
export const confidenceEnum = pgEnum("confidence", ["high", "medium", "low"]);
export const artifactKindEnum = pgEnum("artifact_kind", [
  "screenshot",
  "trace",
  "axe",
  "console_log",
  "network_log",
  "discovery",
  "report_html",
  "report_md",
  "report_json",
  "fix_packet",
]);
export const recommendationKindEnum = pgEnum("recommendation_kind", ["ux", "agentic"]);
export const eventLevelEnum = pgEnum("event_level", ["info", "warn", "error"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** sha256(token) — the raw token only ever lives in the user's cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    csrfToken: text("csrf_token").notNull(),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** sha256 of lowercased email or client key; never the raw value. */
    keyHash: text("key_hash").notNull(),
    success: boolean("success").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("login_attempts_key_time_idx").on(t.keyHash, t.createdAt)],
);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const targets = pgTable(
  "targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    allowedOrigins: jsonb("allowed_origins").$type<string[]>().notNull(),
    allowPrivateNetwork: boolean("allow_private_network").notNull().default(false),
    isStaging: boolean("is_staging").notNull(),
    authorizationConfirmedAt: ts("authorization_confirmed_at").notNull(),
    allowDisposableWrites: boolean("allow_disposable_writes").notNull().default(false),
    prohibitedActionsSummary: text("prohibited_actions_summary").notNull().default(""),
    forbiddenSelectors: jsonb("forbidden_selectors").$type<string[]>().notNull().default([]),
    forbiddenRoutes: jsonb("forbidden_routes").$type<string[]>().notNull().default([]),
    buildLabel: text("build_label"),
    seedResetNotes: text("seed_reset_notes"),
    roleNotes: text("role_notes"),
    startPath: text("start_path").notNull().default("/"),
    authMode: authModeEnum("auth_mode").notNull().default("none"),
    loginUrl: text("login_url"),
    usernameLocator: jsonb("username_locator").$type<Locator>(),
    passwordLocator: jsonb("password_locator").$type<Locator>(),
    submitLocator: jsonb("submit_locator").$type<Locator>(),
    loginSuccessUrlContains: text("login_success_url_contains"),
    loginSuccessLocator: jsonb("login_success_locator").$type<Locator>(),
    discoveryMaxPages: integer("discovery_max_pages").notNull().default(8),
    discoveryMaxDepth: integer("discovery_max_depth").notNull().default(2),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("targets_project_name_uq").on(t.projectId, t.name)],
);

export const targetCredentials = pgTable(
  "target_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => targets.id, { onDelete: "cascade" }),
    label: text("label").notNull().default("primary"),
    /** AES-256-GCM ciphertexts (see @testapp/core crypto). Never returned by APIs. */
    usernameEnc: text("username_enc").notNull(),
    passwordEnc: text("password_enc").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("target_credentials_target_label_uq").on(t.targetId, t.label)],
);

export const briefVersions = pgTable(
  "brief_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => targets.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("brief_versions_target_version_uq").on(t.targetId, t.version)],
);

export type PreflightCheck = {
  name: string;
  status: "passed" | "failed" | "skipped";
  detail: string;
};
export type DiscoverySummary = {
  pages: {
    path: string;
    title: string;
    headings: string[];
    links: string[];
    forms: {
      name: string;
      fields: { label: string; type: string; required: boolean }[];
      submit: string[];
    }[];
    buttons: string[];
    landmarks: string[];
  }[];
  truncated: boolean;
};

export const preflights = pgTable(
  "preflights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => targets.id, { onDelete: "cascade" }),
    status: preflightStatusEnum("status").notNull().default("queued"),
    checks: jsonb("checks").$type<PreflightCheck[]>().notNull().default([]),
    discovery: jsonb("discovery").$type<DiscoverySummary>(),
    error: text("error"),
    createdAt: createdAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("preflights_target_idx").on(t.targetId, t.createdAt)],
);

export const testPlanVersions = pgTable(
  "test_plan_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => targets.id, { onDelete: "cascade" }),
    briefVersionId: uuid("brief_version_id").references(() => briefVersions.id, {
      onDelete: "set null",
    }),
    parentPlanId: uuid("parent_plan_id"),
    version: integer("version").notNull(),
    status: planStatusEnum("status").notNull().default("generating"),
    provider: text("provider").notNull(),
    model: text("model"),
    isFake: boolean("is_fake").notNull(),
    coverage: jsonb("coverage").$type<CoverageRow[]>().notNull().default([]),
    assumptions: jsonb("assumptions").$type<string[]>().notNull().default([]),
    unsupportedAreas: jsonb("unsupported_areas")
      .$type<{ area: string; reason: string }[]>()
      .notNull()
      .default([]),
    tokenUsage: jsonb("token_usage").$type<{ inputTokens: number; outputTokens: number }>(),
    notes: text("notes").notNull().default(""),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("plan_versions_target_version_uq").on(t.targetId, t.version)],
);

export const personas = pgTable(
  "personas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planVersionId: uuid("plan_version_id")
      .notNull()
      .references(() => testPlanVersions.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    data: jsonb("data").$type<Persona>().notNull(),
  },
  (t) => [uniqueIndex("personas_plan_key_uq").on(t.planVersionId, t.key)],
);

export const journeys = pgTable(
  "journeys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planVersionId: uuid("plan_version_id")
      .notNull()
      .references(() => testPlanVersions.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    data: jsonb("data").$type<Journey>().notNull(),
  },
  (t) => [uniqueIndex("journeys_plan_key_uq").on(t.planVersionId, t.key)],
);

export const scenarios = pgTable(
  "scenarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planVersionId: uuid("plan_version_id")
      .notNull()
      .references(() => testPlanVersions.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    version: integer("version").notNull().default(1),
    ordinal: integer("ordinal").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    definition: jsonb("definition").$type<Scenario>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("scenarios_plan_key_uq").on(t.planVersionId, t.key)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: jobKindEnum("kind").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    payload: jsonb("payload").$type<Record<string, string>>().notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: ts("lease_expires_at"),
    heartbeatAt: ts("heartbeat_at"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(1),
    error: text("error"),
    createdAt: createdAt(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("jobs_status_created_idx").on(t.status, t.createdAt)],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => targets.id, { onDelete: "cascade" }),
    planVersionId: uuid("plan_version_id")
      .notNull()
      .references(() => testPlanVersions.id, { onDelete: "restrict" }),
    rerunOfRunId: uuid("rerun_of_run_id"),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    status: runStatusEnum("status").notNull().default("queued"),
    statusReason: text("status_reason"),
    config: jsonb("config").$type<RunConfig>().notNull(),
    runPrefix: text("run_prefix").notNull(),
    provider: text("provider").notNull(),
    isFake: boolean("is_fake").notNull(),
    budgetUsage: jsonb("budget_usage").$type<BudgetUsage>(),
    budgetExhausted: text("budget_exhausted"),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    targetBuildLabel: text("target_build_label"),
    browser: text("browser"),
    viewport: text("viewport"),
    analysisSummary: text("analysis_summary"),
    report: jsonb("report").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("runs_target_created_idx").on(t.targetId, t.createdAt)],
);

export type BrowserEvent = {
  type: "console" | "page_error" | "network" | "blocked_navigation";
  message: string;
  url?: string;
  status?: number;
  method?: string;
  /** Index of the step during which the event happened (-1 before the first step). */
  step?: number;
  at: string;
};

export const scenarioResults = pgTable(
  "scenario_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    scenarioId: uuid("scenario_id").references(() => scenarios.id, { onDelete: "set null" }),
    scenarioKey: text("scenario_key").notNull(),
    scenarioVersion: integer("scenario_version").notNull(),
    title: text("title").notNull(),
    ordinal: integer("ordinal").notNull(),
    /** Snapshot of the executed scenario definition (plan edits never rewrite history). */
    definition: jsonb("definition").$type<Scenario>().notNull(),
    status: scenarioStatusEnum("status").notNull().default("pending"),
    reason: text("reason"),
    actionCount: integer("action_count").notNull().default(0),
    browserEvents: jsonb("browser_events").$type<BrowserEvent[]>().notNull().default([]),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    durationMs: integer("duration_ms"),
  },
  (t) => [uniqueIndex("scenario_results_run_key_uq").on(t.runId, t.scenarioKey)],
);

export const stepResults = pgTable(
  "step_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    scenarioResultId: uuid("scenario_result_id")
      .notNull()
      .references(() => scenarioResults.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    action: text("action").notNull(),
    description: text("description").notNull(),
    status: stepStatusEnum("status").notNull(),
    expected: text("expected"),
    actual: text("actual"),
    error: text("error"),
    url: text("url"),
    durationMs: integer("duration_ms").notNull().default(0),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("step_results_scenario_index_uq").on(t.scenarioResultId, t.index)],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }),
    preflightId: uuid("preflight_id").references(() => preflights.id, { onDelete: "cascade" }),
    scenarioResultId: uuid("scenario_result_id").references(() => scenarioResults.id, {
      onDelete: "set null",
    }),
    stepResultId: uuid("step_result_id").references(() => stepResults.id, { onDelete: "set null" }),
    kind: artifactKindEnum("kind").notNull(),
    label: text("label").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("artifacts_run_idx").on(t.runId)],
);

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    category: findingCategoryEnum("category").notNull(),
    title: text("title").notNull(),
    severity: severityEnum("severity").notNull(),
    priority: text("priority").notNull(),
    confidence: confidenceEnum("confidence").notNull(),
    source: text("source").notNull(),
    scenarioKey: text("scenario_key"),
    data: jsonb("data")
      .$type<{
        description: string;
        personaKey?: string;
        journeyKey?: string;
        preconditions: string[];
        reproSteps: string[];
        expected?: string;
        actual?: string;
        pageUrl?: string;
        targetVersion?: string;
        browser?: string;
        viewport?: string;
        evidence: EvidenceRef[];
        reproducibility: string;
        occurrences: number;
        suggestedRegressionTest?: string;
        standardsRefs: StandardRef[];
      }>()
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("findings_run_fingerprint_uq").on(t.runId, t.fingerprint),
    index("findings_fingerprint_idx").on(t.fingerprint),
  ],
);

export const recommendations = pgTable("recommendations", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  kind: recommendationKindEnum("kind").notNull(),
  data: jsonb("data").$type<UxRecommendation | AgenticRecommendation>().notNull(),
  createdAt: createdAt(),
});

export const runEvents = pgTable(
  "run_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }),
    targetId: uuid("target_id").references(() => targets.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    level: eventLevelEnum("level").notNull().default("info"),
    type: text("type").notNull(),
    message: text("message").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: ts("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    index("run_events_run_idx").on(t.runId, t.id),
    index("run_events_target_idx").on(t.targetId, t.id),
  ],
);
