import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  combineFindings,
  deriveObservedFindings,
  normaliseForFingerprint,
  type AnalyserRun,
  type AnalyserScenario,
} from "../src/findings";
import { compareRuns, type CompareRun } from "../src/regression";
import {
  buildReport,
  renderFixPacket,
  renderHtml,
  renderMarkdown,
  reportSchema,
  type ReportInput,
} from "../src/report";
import {
  agenticRecommendationSchema,
  analysisOutputSchema,
  findingSchema,
} from "../src/schemas/findings";
import { generatedPlanSchema } from "../src/schemas/plan";

const plan = generatedPlanSchema.parse(
  (
    JSON.parse(
      readFileSync(path.resolve(__dirname, "../fixtures/plans/taskpad-demo.json"), "utf8"),
    ) as { plan: unknown }
  ).plan,
);
const def = (key: string) => plan.scenarios.find((s) => s.key === key)!;

function scenario(
  key: string,
  status: string,
  steps: AnalyserScenario["steps"],
  extra: Partial<AnalyserScenario> = {},
): AnalyserScenario {
  return {
    id: `sr-${key}`,
    key,
    status,
    reason: null,
    definition: def(key),
    steps,
    events: [],
    stepArtifacts: {},
    scenarioArtifacts: [],
    ...extra,
  };
}
const step = (id: string, index: number, over: Partial<AnalyserScenario["steps"][number]>) => ({
  id,
  index,
  action: "assertVisible",
  description: "d",
  status: "passed",
  expected: null,
  actual: null,
  error: null,
  url: "http://t.test/tasks",
  details: null,
  ...over,
});

function runWith(scenarios: AnalyserScenario[], prefix = "TA-AAAAAA"): AnalyserRun {
  return {
    runPrefix: prefix,
    targetVersion: "1.0",
    browser: "chromium",
    viewport: "1366x900",
    scenarios,
  };
}

const failing = (prefix: string) =>
  scenario(
    "SC-005",
    "failed",
    [
      step("s1", 7, {
        status: "failed",
        expected: `text "${prefix} Renamed" is visible`,
        actual: "no matching element on the page",
        details: { assertion: true },
      }),
    ],
    { stepArtifacts: { s1: [{ id: "11111111-1111-4111-8111-111111111111", kind: "screenshot" }] } },
  );

describe("finding classification and evidence", () => {
  it("derives observed failures only from failed assertions, with evidence", () => {
    const f = deriveObservedFindings(
      runWith([failing("TA-AAAAAA"), scenario("SC-001", "passed", [step("s2", 0, {})])]),
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      category: "observed_failure",
      scenarioKey: "SC-005",
      source: "execution",
      confidence: "medium",
    });
    expect(f[0]!.evidence.some((e) => e.artifactId)).toBe(true);
  });

  it("does not report blocked or inconclusive automation as defects", () => {
    const f = deriveObservedFindings(
      runWith([
        scenario("SC-002", "blocked", [
          step("b1", 1, {
            action: "click",
            status: "blocked",
            error: "automation blocked: element not found",
          }),
        ]),
        scenario("SC-003", "inconclusive", [
          step("b2", 0, { action: "navigate", status: "error", error: "timeout" }),
        ]),
      ]),
    );
    expect(f).toHaveLength(0);
  });

  it("rejects observed findings without evidence or from LLM output", () => {
    const base = {
      key: "F-001",
      fingerprint: "abcdefabcdef",
      title: "t",
      description: "d",
      severity: "high",
      priority: "P1",
      confidence: "high",
    };
    expect(
      findingSchema.safeParse({
        ...base,
        category: "observed_failure",
        source: "execution",
        evidence: [],
      }).success,
    ).toBe(false);
    expect(
      findingSchema.safeParse({
        ...base,
        category: "observed_failure",
        source: "llm_analysis",
        evidence: [{ kind: "assertion", description: "x" }],
      }).success,
    ).toBe(false);
    expect(
      findingSchema.safeParse({
        ...base,
        category: "inferred_risk",
        source: "llm_analysis",
        evidence: [],
      }).success,
    ).toBe(true);
  });

  it("maps axe violations to automated standard results with WCAG references and merges by rule+page", () => {
    const axe = {
      automatedCheck: true,
      axe: [
        {
          id: "label",
          impact: "critical",
          help: "Form elements must have labels",
          count: 1,
          tags: ["wcag2a", "wcag412", "wcag131"],
        },
      ],
    };
    const a = scenario(
      "SC-007",
      "failed",
      [step("a1", 2, { action: "runAccessibilityCheck", status: "failed", details: axe })],
      { stepArtifacts: { a1: [{ id: "22222222-2222-4222-8222-222222222222", kind: "axe" }] } },
    );
    const b = scenario(
      "SC-001",
      "failed",
      [step("a2", 3, { action: "runAccessibilityCheck", status: "failed", details: axe })],
      { stepArtifacts: { a2: [{ id: "33333333-3333-4333-8333-333333333333", kind: "axe" }] } },
    );
    const f = deriveObservedFindings(runWith([a, b]));
    expect(f).toHaveLength(1);
    expect(f[0]!.occurrences).toBe(2);
    expect(f[0]!.standardsRefs.map((r) => r.ref)).toEqual(
      expect.arrayContaining(["SC 4.1.2", "SC 1.3.1"]),
    );
  });

  it("deduplicates repeated runtime symptoms conservatively", () => {
    const ev = (message: string, url = "http://t.test/reports") => ({
      type: "page_error",
      message,
      url,
      step: 0,
    });
    const s1 = scenario("SC-006", "failed", [], {
      events: [ev("TypeError: Cannot read properties of undefined (reading 'total')")],
    });
    const s2 = scenario("SC-009", "passed", [], {
      events: [
        ev("TypeError: Cannot read properties of undefined (reading 'total')"),
        ev("ReferenceError: x is not defined"),
      ],
    });
    const f = deriveObservedFindings(runWith([s1, s2]));
    const runtime = f.filter((x) => x.category === "observed_runtime_symptom");
    expect(runtime).toHaveLength(2);
    expect(runtime.find((x) => x.title.includes("TypeError"))!.occurrences).toBe(2);
  });

  it("produces fingerprints that are stable across run prefixes", () => {
    const a = deriveObservedFindings(runWith([failing("TA-AAAAAA")], "TA-AAAAAA"))[0]!;
    const b = deriveObservedFindings(runWith([failing("TA-BBBBBB")], "TA-BBBBBB"))[0]!;
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(normaliseForFingerprint("Item 42 at https://x.test/a?b TA-ZZZZZZ")).toBe(
      "item <n> at <url> {{run}}",
    );
  });

  it("never lets provider analysis add observed categories", () => {
    const analysis = analysisOutputSchema.parse({
      uxRecommendations: [],
      agenticOpportunities: [],
      summary: "s",
      inferredRisks: [
        {
          title: "Edit may lose data",
          description: "d",
          basis: "brief",
          severity: "high",
          confidence: "low",
        },
      ],
    });
    const all = combineFindings([], analysis);
    expect(all.map((f) => f.category)).toEqual(["inferred_risk"]);
    expect(() => analysisOutputSchema.parse({ ...analysis, observedFailures: [] })).toThrow();
  });
});

describe("agentic recommendation schema", () => {
  it("requires autonomy, approvals, recovery and evaluation fields", () => {
    const ok = {
      title: "t",
      userProblem: "p",
      trigger: "x",
      requiredContext: ["c"],
      toolsRequired: ["t"],
      autonomyLevel: "draft",
      permissionsAndApprovals: "a",
      memoryState: "m",
      failureRecovery: "f",
      evaluationCriteria: ["e"],
      expectedValue: "low",
      implementationEffort: "low",
      operationalRisk: "low",
      basis: "b",
    };
    expect(agenticRecommendationSchema.safeParse(ok).success).toBe(true);
    expect(
      agenticRecommendationSchema.safeParse({ ...ok, autonomyLevel: "full_autonomy" }).success,
    ).toBe(false);
    const { failureRecovery: _f, ...missing } = ok;
    expect(agenticRecommendationSchema.safeParse(missing).success).toBe(false);
  });
});

describe("report exports", () => {
  const findings = deriveObservedFindings(runWith([failing("TA-AAAAAA")]));
  const input: ReportInput = {
    run: {
      id: "44444444-4444-4444-8444-444444444444",
      status: "partial",
      statusReason: "total browser actions budget reached",
      createdAt: new Date(0),
      startedAt: new Date(0),
      finishedAt: new Date(1000),
      config: {
        browserProfile: "chromium-desktop",
        budgets: {
          maxElapsedMinutes: 1,
          maxScenarios: 1,
          maxActionsPerScenario: 1,
          maxTotalActions: 1,
          maxInputTokens: 1,
          maxOutputTokens: 1,
          maxEstimatedCostUsd: 1,
          maxRepeatedActions: 1,
          maxConsecutiveBlocked: 1,
        },
      },
      browser: "chromium 1",
      viewport: "1366x900",
      runPrefix: "TA-AAAAAA",
      rerunOfRunId: null,
      budgetExhausted: "maxTotalActions",
      budgetUsage: null,
      analysisSummary: null,
      provider: "fake",
      isFake: true,
    },
    plan: {
      version: 1,
      model: "fake",
      coverage: plan.coverage,
      unsupportedAreas: plan.unsupportedAreas,
    },
    target: { name: "T <script>", baseUrl: "http://t.test/", buildLabel: "1.0" },
    scenarios: [
      {
        id: "sr-SC-005",
        key: "SC-005",
        version: 1,
        title: "Edit",
        priority: "P0",
        riskArea: "persistence",
        personaKey: "P-MEMBER",
        journeyKey: "J-EDIT",
        status: "failed",
        reason: null,
        durationMs: 10,
      },
    ],
    steps: [],
    artifacts: [],
    findings,
    ux: [],
    agentic: [],
  };

  it("builds a schema-valid partial report that is never labelled complete", () => {
    const r = buildReport(input);
    expect(reportSchema.safeParse(r).success).toBe(true);
    expect(r.summary.completeness).toBe("partial");
    expect(r.summary.budgetStatus).toMatch(/total browser actions/);
    expect(r.limitations.join(" ")).toMatch(/does not represent complete coverage/);
  });

  it("renders Markdown, escaped HTML and a fix packet with instructions", () => {
    const r = buildReport(input);
    expect(renderMarkdown(r)).toContain("## 3. Bugs and runtime symptoms");
    const html = renderHtml(r);
    expect(html).not.toContain("T <script>");
    expect(html).toContain("T &lt;script&gt;");
    const fp = renderFixPacket(r);
    expect(fp).toContain("Do not blindly trust the speculative section");
    expect(fp).toContain(findings[0]!.key);
  });
});

describe("regression comparison", () => {
  const f = (fp: string, scenarioKey: string) => ({
    key: `F-${fp}`,
    fingerprint: fp,
    category: "observed_failure" as const,
    title: fp,
    scenarioKey,
  });
  const run = (
    id: string,
    scen: [string, number, string][],
    fs: ReturnType<typeof f>[],
  ): CompareRun => ({
    id,
    scenarios: scen.map(([key, version, status]) => ({ key, version, status, title: key })),
    findings: fs,
  });

  it("classifies new, persistent, regressed, resolved and not_retested correctly", () => {
    const base = run(
      "b",
      [
        ["SC-1", 1, "failed"],
        ["SC-2", 1, "passed"],
        ["SC-3", 1, "failed"],
        ["SC-4", 1, "failed"],
        ["SC-6", 1, "failed"],
      ],
      [f("p", "SC-1"), f("r", "SC-3"), f("n", "SC-4"), f("v", "SC-6")],
    );
    const head = run(
      "h",
      [
        ["SC-1", 1, "failed"],
        ["SC-2", 1, "failed"],
        ["SC-3", 1, "passed"],
        ["SC-5", 1, "failed"],
        ["SC-6", 2, "passed"],
      ],
      [f("p", "SC-1"), f("g", "SC-2"), f("x", "SC-5")],
    );
    const c = compareRuns(base, head);
    const by = Object.fromEntries(c.findings.map((x) => [x.fingerprint, x.status]));
    expect(by).toEqual({
      p: "persistent",
      g: "regressed",
      x: "new",
      r: "resolved",
      n: "not_retested",
      v: "not_retested",
    });
    expect(c.scenarios.find((s) => s.key === "SC-6")!.change).toBe("definition_changed");
    expect(c.scenarios.find((s) => s.key === "SC-2")!.change).toBe("regressed");
  });

  it("never marks a finding resolved when the rerun failed for another reason", () => {
    const base = run("b", [["SC-1", 1, "failed"]], [f("a", "SC-1")]);
    const head = run("h", [["SC-1", 1, "failed"]], [f("b", "SC-1")]);
    expect(compareRuns(base, head).findings.find((x) => x.fingerprint === "a")!.status).toBe(
      "not_retested",
    );
  });
});
