import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  type AnalysisInput,
  type AnalysisOutput,
  analysisOutputSchema,
  enforcePlanLimits,
  type GeneratedPlan,
  generatedPlanSchema,
  type LlmProvider,
  type PlanningInput,
  ProviderError,
  type ProviderResult,
  type ScenarioInput,
} from "@testapp/core";

/**
 * Deterministic, offline provider for the demo and CI. It never touches the
 * network. Plans come from a fixture whose `match` string appears in the brief,
 * otherwise a generic plan is derived from discovery data. Run results are
 * NEVER fabricated here: the runner really executes whatever this returns.
 */
type Fixture = { match: string; plan: unknown };

export function resolveFixtureDir(explicit?: string): string | null {
  const candidates = [
    explicit,
    path.resolve(process.cwd(), "packages/core/fixtures"),
    path.resolve(process.cwd(), "../../packages/core/fixtures"),
    path.resolve(process.cwd(), "fixtures"),
  ].filter((c): c is string => Boolean(c));
  return candidates.find((c) => existsSync(path.join(c, "plans"))) ?? null;
}

export class FakeProvider implements LlmProvider {
  readonly name = "fake" as const;
  readonly isFake = true;
  readonly model = "fake-deterministic-v1";
  private readonly fixtures: Fixture[];

  constructor(fixtureDir?: string | null) {
    const dir = fixtureDir === undefined ? resolveFixtureDir() : fixtureDir;
    this.fixtures = [];
    if (dir) {
      const plansDir = path.join(dir, "plans");
      for (const f of readdirSync(plansDir)
        .filter((x) => x.endsWith(".json"))
        .sort()) {
        this.fixtures.push(JSON.parse(readFileSync(path.join(plansDir, f), "utf8")) as Fixture);
      }
    }
  }

  async generatePlan(input: PlanningInput): Promise<ProviderResult<GeneratedPlan>> {
    const fixture = this.fixtures.find((f) => input.brief.includes(f.match));
    const raw = fixture ? fixture.plan : genericPlan(input);
    const parsed = generatedPlanSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ProviderError(
        `fake provider fixture is invalid: ${parsed.error.issues[0]?.message}`,
        "malformed",
      );
    }
    const { plan } = enforcePlanLimits(parsed.data, input.limits);
    return { data: plan, usage: { inputTokens: 0, outputTokens: 0 }, model: this.model };
  }

  async analyseRun(input: AnalysisInput): Promise<ProviderResult<AnalysisOutput>> {
    const out: AnalysisOutput = {
      uxRecommendations: [],
      agenticOpportunities: [],
      inferredRisks: [],
      summary: "",
    };
    const failed = input.scenarios.filter((s) => s.status === "failed");
    const persistence = failed.filter((s) => s.riskArea === "persistence");
    if (persistence.length) {
      out.uxRecommendations.push({
        title: "Confirm saves only after the change is persisted",
        affectedJourney: persistence.map((s) => s.journeyKey).join(", "),
        userConsequence:
          "Users are told a change succeeded but later find the old value, eroding trust and causing silent data loss.",
        currentBehaviour: `Scenario(s) ${persistence.map((s) => s.key).join(", ")} failed: the expected updated value was not shown after saving.`,
        recommendedChange:
          "Show the success message only after the server confirms the write, and render the saved value from the server response.",
        basis: "evidence",
        basisDetail: "Failed persistence assertions in the listed scenarios.",
        evidenceScenarioKeys: persistence.map((s) => s.key),
        confidence: "medium",
        implementationEffort: "low",
        heuristicRef: "Nielsen #1: Visibility of system status",
      });
    }
    if (input.accessibilityRules.some((r) => r.id === "label" || r.id === "select-name")) {
      out.uxRecommendations.push({
        title: "Give every form control a visible, programmatic label",
        affectedJourney: "All journeys using filters or forms",
        userConsequence:
          "Screen-reader and voice-control users cannot identify or target unlabeled controls.",
        currentBehaviour: "axe-core reported controls without an accessible name.",
        recommendedChange:
          "Associate a <label> (or aria-label) with each control; avoid relying on adjacent text.",
        basis: "evidence",
        basisDetail: "Automated axe-core rule results (label/select-name).",
        evidenceScenarioKeys: [],
        confidence: "high",
        implementationEffort: "low",
        heuristicRef: "WCAG 2.2 SC 1.3.1 / 4.1.2",
      });
    }
    out.uxRecommendations.push({
      title: "Make empty and error states explicit",
      affectedJourney: "First-run and error handling",
      userConsequence:
        "Without explicit empty/error states users cannot tell whether data is loading, missing or failed.",
      currentBehaviour: "Not directly observed; derived from general usability heuristics.",
      recommendedChange: "Provide distinct empty, loading and error states with a recovery action.",
      basis: "heuristic",
      basisDetail: "Generic heuristic recommendation produced by the deterministic fake provider.",
      evidenceScenarioKeys: [],
      confidence: "low",
      implementationEffort: "medium",
      heuristicRef: "Nielsen #9: Help users recognize, diagnose, and recover from errors",
    });

    const briefLower = input.brief.toLowerCase();
    if (briefLower.includes("task")) {
      out.agenticOpportunities.push({
        title: "Draft task breakdowns from a short goal",
        userProblem: "Users manually split goals into several tasks with titles and due dates.",
        trigger: "User types a goal into a 'Plan with assistant' box on the task list.",
        requiredContext: ["The goal text", "Existing open task titles (to avoid duplicates)"],
        toolsRequired: ["Read open tasks", "Create task (only after approval)"],
        autonomyLevel: "draft",
        permissionsAndApprovals:
          "The assistant drafts tasks; nothing is created until the user approves each draft.",
        memoryState: "No long-term memory; drafts live in the current page session only.",
        failureRecovery:
          "On error or low-quality drafts, the user edits or discards them and creates tasks manually as today.",
        evaluationCriteria: [
          "Share of drafts accepted without edits",
          "Duplicate-task rate",
          "Time to create a plan",
        ],
        expectedValue: "medium",
        implementationEffort: "medium",
        operationalRisk: "low",
        deterministicAlternative:
          "Recurring tasks are better served by a deterministic 'repeat' rule than an agent.",
        basis: "Inferred from the brief's description of task creation; not observed in execution.",
      });
    }
    out.agenticOpportunities.push({
      title: "Triage failed saves and runtime errors for support",
      userProblem: "Support staff manually correlate user complaints with client-side errors.",
      trigger: "A client-side error or failed save is reported.",
      requiredContext: ["Sanitised error message", "Page route", "Build label"],
      toolsRequired: ["Search error logs", "Draft an issue (no auto-filing)"],
      autonomyLevel: "recommend",
      permissionsAndApprovals: "Read-only access to logs; a human files any issue.",
      memoryState: "Links between recurring error fingerprints and filed issues.",
      failureRecovery: "Falls back to the existing manual triage queue.",
      evaluationCriteria: ["Correct grouping of duplicate errors", "Time to first triage"],
      expectedValue: "low",
      implementationEffort: "medium",
      operationalRisk: "low",
      deterministicAlternative:
        "Error grouping by fingerprint is deterministic; an agent only adds value for summarising.",
      basis: "Heuristic; derived from observed runtime symptoms if any.",
    });

    for (const gap of input.coverageGaps.slice(0, 5)) {
      out.inferredRisks.push({
        title: `Untested area: ${gap}`.slice(0, 300),
        description:
          "This area was not exercised by an executed scenario, so defects there would not be detected by this run.",
        basis: "Coverage matrix gap (not observed).",
        severity: "info",
        confidence: "low",
        suggestedTest: "Add a scenario once the brief specifies the expected behaviour.",
      });
    }
    if (!/role|permission|admin/.test(briefLower)) {
      out.inferredRisks.push({
        title: "Role separation is unspecified",
        description:
          "The brief does not describe roles or permissions, so authorisation boundaries were not tested.",
        basis: "Absence of role information in the brief.",
        severity: "low",
        confidence: "low",
      });
    }
    out.summary = `Deterministic fake-provider analysis (no real LLM). ${input.scenarios.length} scenario outcomes, ${failed.length} failed. Recommendations are templated, not model-generated.`;
    return {
      data: analysisOutputSchema.parse(out),
      usage: { inputTokens: 0, outputTokens: 0 },
      model: this.model,
    };
  }
}

/** Generic, discovery-driven smoke plan for targets without a fixture. */
export function genericPlan(input: PlanningInput): GeneratedPlan {
  const pages = (input.discovery?.pages ?? []).slice(0, Math.max(1, input.limits.maxScenarios - 1));
  const scenarios: ScenarioInput[] = [];
  const startRoute = input.target.startPath || "/";
  scenarios.push({
    key: "SC-001",
    title: "Starting page loads for the persona",
    rationale:
      "Smoke check that the configured starting route renders and passes automated accessibility checks.",
    priority: "P0",
    riskArea: "core_flow",
    personaKey: "P-USER",
    journeyKey: "J-EXPLORE",
    preconditions: input.target.authMode === "form" ? ["Signed in with the synthetic account"] : [],
    startRoute,
    requiresAuth: input.target.authMode === "form",
    dataMode: "read_only",
    prohibitedActionClass: "none",
    maxActions: 5,
    steps: [
      { action: "navigate", target: startRoute },
      { action: "assertUrl", contains: startRoute },
      { action: "runAccessibilityCheck", label: "start page" },
    ],
    expectedOutcomes: ["The starting page loads without navigation errors"],
  });
  pages
    .filter((p) => p.path !== startRoute)
    .forEach((p, i) => {
      const steps: ScenarioInput["steps"] = [
        { action: "navigate", target: p.path },
        { action: "assertUrl", contains: p.path.split("?")[0] ?? p.path },
      ];
      const h = p.headings[0];
      if (h)
        steps.push({
          action: "assertVisible",
          locator: { by: "role", role: "heading", name: h.slice(0, 200) },
        });
      steps.push({ action: "runAccessibilityCheck", label: p.path.slice(0, 100) });
      scenarios.push({
        key: `SC-${String(i + 2).padStart(3, "0")}`,
        title: `Discovered page ${p.path} renders`.slice(0, 300),
        rationale:
          "Generated from bounded discovery: verifies the page loads and its main heading is visible.",
        priority: "P2",
        riskArea: "navigation",
        personaKey: "P-USER",
        journeyKey: "J-EXPLORE",
        preconditions: [],
        startRoute: p.path.startsWith("/") ? p.path : "/",
        requiresAuth: input.target.authMode === "form",
        dataMode: "read_only",
        prohibitedActionClass: "none",
        maxActions: 6,
        steps,
        expectedOutcomes: ["Page loads and its primary heading is visible"],
      });
    });
  return generatedPlanSchema.parse({
    personas: [
      {
        key: "P-USER",
        name: "Typical signed-in user",
        role:
          input.target.authMode === "form"
            ? "Authenticated user (synthetic account)"
            : "Anonymous visitor",
        permissions: ["Whatever the synthetic account is granted; not inferred"],
        goal: "Reach the main areas of the application",
        successCriterion: "Pages load and are usable",
        productFamiliarity: "medium",
        technicalConfidence: "medium",
        deviceProfile: "desktop",
        accessibilityNeeds: [],
        startingDataState: "Existing staging data",
        behaviours: ["Navigates via visible links"],
        mayNotPerform: ["Purchases", "Deleting data", "Sending messages"],
      },
    ],
    journeys: [
      {
        key: "J-EXPLORE",
        title: "Explore discovered pages",
        personaKeys: ["P-USER"],
        summary: "Visit discovered same-origin pages.",
        priority: "P1",
      },
    ],
    coverage: [
      {
        area: "Page availability",
        journeyKey: "J-EXPLORE",
        scenarioKeys: scenarios.map((s) => s.key),
        status: "partial",
        notes: "Smoke-level only",
      },
      {
        area: "Business rules",
        scenarioKeys: [],
        status: "unsupported",
        notes: "Generic plan: no business rules inferred from the brief",
      },
    ],
    scenarios,
    assumptions: [
      "Generic plan generated without a fixture; it checks availability and automated accessibility only.",
    ],
    unsupportedAreas: [
      {
        area: "Business rules and permissions",
        reason: "The fake provider does not interpret briefs.",
      },
    ],
  });
}
