import { z } from "zod";
import {
  type AgenticRecommendation,
  agenticRecommendationSchema,
  CATEGORY_LABELS,
  type Finding,
  findingSchema,
  OBSERVED_CATEGORIES,
  type UxRecommendation,
  uxRecommendationSchema,
} from "./schemas/findings";
import { type CoverageRow, PRIORITIES } from "./schemas/plan";
import {
  type Budgets,
  budgetsSchema,
  budgetUsageSchema,
  BUDGET_NAMES,
  RUN_STATUSES,
  SCENARIO_STATUSES,
} from "./schemas/run";

export const REPORT_SCHEMA_VERSION = "1.0";

const stepSchema = z.object({
  index: z.number(),
  description: z.string(),
  status: z.string(),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
  error: z.string().nullable(),
  url: z.string().nullable(),
  artifactIds: z.array(z.string()),
});

export const reportSchema = z
  .object({
    schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
    generatedAt: z.string(),
    run: z.object({
      id: z.string(),
      status: z.enum(RUN_STATUSES),
      statusReason: z.string().nullable(),
      createdAt: z.string(),
      startedAt: z.string().nullable(),
      finishedAt: z.string().nullable(),
      browserProfile: z.string(),
      browser: z.string().nullable(),
      viewport: z.string().nullable(),
      runPrefix: z.string(),
      rerunOfRunId: z.string().nullable(),
      planVersion: z.number(),
      budgetExhausted: z.string().nullable(),
      budgets: budgetsSchema,
      usage: budgetUsageSchema.nullable(),
    }),
    target: z.object({
      name: z.string(),
      baseUrl: z.string(),
      buildLabel: z.string().nullable(),
      environment: z.literal("staging"),
    }),
    provider: z.object({ name: z.string(), model: z.string().nullable(), isFake: z.boolean() }),
    summary: z.object({
      scenarioCounts: z.record(z.enum(SCENARIO_STATUSES), z.number()),
      tested: z.array(z.string()),
      notTested: z.array(z.string()),
      topFindingKeys: z.array(z.string()),
      budgetStatus: z.string(),
      completeness: z.enum(["complete", "partial", "failed", "cancelled", "in_progress"]),
      analysisSummary: z.string().nullable(),
    }),
    coverage: z.array(
      z.object({
        area: z.string(),
        journeyKey: z.string().nullable(),
        scenarioKeys: z.array(z.string()),
        planStatus: z.string(),
        executed: z.record(z.string(), z.number()),
        notes: z.string(),
      }),
    ),
    unsupportedAreas: z.array(z.object({ area: z.string(), reason: z.string() })),
    scenarios: z.array(
      z.object({
        key: z.string(),
        version: z.number(),
        title: z.string(),
        priority: z.string(),
        riskArea: z.string(),
        personaKey: z.string(),
        journeyKey: z.string(),
        status: z.enum(SCENARIO_STATUSES),
        reason: z.string().nullable(),
        durationMs: z.number().nullable(),
        steps: z.array(stepSchema),
        artifactIds: z.array(z.string()),
      }),
    ),
    findings: z.array(findingSchema),
    uxRecommendations: z.array(uxRecommendationSchema),
    agenticOpportunities: z.array(agenticRecommendationSchema),
    standards: z.object({
      observations: z.array(
        z.object({
          standard: z.string(),
          ref: z.string(),
          observation: z.string(),
          basis: z.string(),
          findingKeys: z.array(z.string()),
        }),
      ),
      disclaimer: z.string(),
    }),
    limitations: z.array(z.string()),
    manualTesting: z.array(z.string()),
    regression: z.object({
      suite: z.array(z.object({ scenarioKey: z.string(), title: z.string(), reason: z.string() })),
      retest: z.array(z.string()),
    }),
    artifacts: z.array(
      z.object({
        id: z.string(),
        kind: z.string(),
        label: z.string(),
        scenarioKey: z.string().nullable(),
        stepIndex: z.number().nullable(),
        sha256: z.string(),
        sizeBytes: z.number(),
      }),
    ),
  })
  .strict()
  .superRefine((r, ctx) => {
    r.findings.forEach((f, i) => {
      if (OBSERVED_CATEGORIES.has(f.category) && f.evidence.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["findings", i],
          message: "observed finding without evidence",
        });
      }
    });
  });
export type Report = z.infer<typeof reportSchema>;

export type ReportInput = {
  run: {
    id: string;
    status: Report["run"]["status"];
    statusReason: string | null;
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
    config: { browserProfile: string; budgets: Budgets };
    browser: string | null;
    viewport: string | null;
    runPrefix: string;
    rerunOfRunId: string | null;
    budgetExhausted: string | null;
    budgetUsage: Report["run"]["usage"];
    analysisSummary: string | null;
    provider: string;
    isFake: boolean;
  };
  plan: {
    version: number;
    model: string | null;
    coverage: CoverageRow[];
    unsupportedAreas: { area: string; reason: string }[];
  };
  target: { name: string; baseUrl: string; buildLabel: string | null };
  scenarios: {
    id: string;
    key: string;
    version: number;
    title: string;
    priority: string;
    riskArea: string;
    personaKey: string;
    journeyKey: string;
    status: Report["scenarios"][number]["status"];
    reason: string | null;
    durationMs: number | null;
  }[];
  steps: {
    id: string;
    scenarioResultId: string;
    index: number;
    description: string;
    status: string;
    expected: string | null;
    actual: string | null;
    error: string | null;
    url: string | null;
    details: Record<string, unknown> | null;
  }[];
  artifacts: {
    id: string;
    kind: string;
    label: string;
    scenarioResultId: string | null;
    stepResultId: string | null;
    sha256: string;
    sizeBytes: number;
  }[];
  findings: Finding[];
  ux: UxRecommendation[];
  agentic: AgenticRecommendation[];
};

const DISCLAIMER =
  "Automated checks (axe-core rules, passive header inspection) do not certify WCAG, OWASP ASVS or any other compliance. " +
  "Passive observation is not penetration testing. Standards references indicate where to look, not a conformance verdict.";

export function buildReport(input: ReportInput, now = new Date()): Report {
  const { run } = input;
  const counts = Object.fromEntries(SCENARIO_STATUSES.map((s) => [s, 0])) as Record<
    (typeof SCENARIO_STATUSES)[number],
    number
  >;
  for (const s of input.scenarios) counts[s.status]++;
  const stepsByScenario = new Map<string, ReportInput["steps"]>();
  for (const st of input.steps)
    stepsByScenario.set(st.scenarioResultId, [
      ...(stepsByScenario.get(st.scenarioResultId) ?? []),
      st,
    ]);
  const artByStep = new Map<string, string[]>();
  const artByScenario = new Map<string, string[]>();
  for (const a of input.artifacts) {
    if (a.stepResultId)
      artByStep.set(a.stepResultId, [...(artByStep.get(a.stepResultId) ?? []), a.id]);
    if (a.scenarioResultId)
      artByScenario.set(a.scenarioResultId, [
        ...(artByScenario.get(a.scenarioResultId) ?? []),
        a.id,
      ]);
  }
  const scenarioKeyById = new Map(input.scenarios.map((s) => [s.id, s.key]));
  const stepIndexById = new Map(input.steps.map((s) => [s.id, s.index]));
  const statusByKey = new Map(input.scenarios.map((s) => [s.key, s.status]));

  const executedStatuses = new Set(["passed", "failed"]);
  const tested = input.scenarios
    .filter((s) => executedStatuses.has(s.status))
    .map((s) => `${s.key} ${s.title} (${s.status})`);
  const notTested = [
    ...input.scenarios
      .filter((s) => !executedStatuses.has(s.status))
      .map((s) => `${s.key} ${s.title} (${s.status}${s.reason ? `: ${s.reason}` : ""})`),
    ...input.plan.coverage
      .filter((c) => c.status === "unsupported" || c.status === "not_covered")
      .map((c) => `${c.area} (${c.status.replace("_", " ")})`),
  ];
  const rank = (f: Finding) =>
    PRIORITIES.indexOf(f.priority) * 10 + (OBSERVED_CATEGORIES.has(f.category) ? 0 : 5);
  const observed = input.findings.filter((f) => OBSERVED_CATEGORIES.has(f.category));
  const top = [...observed]
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 5)
    .map((f) => f.key);

  const budgetStatus = run.budgetExhausted
    ? `Stopped early: ${BUDGET_NAMES[run.budgetExhausted as keyof Budgets] ?? run.budgetExhausted} budget reached. Coverage is incomplete.`
    : run.status === "cancelled"
      ? "Cancelled by emergency stop. Coverage is incomplete."
      : run.status === "partial"
        ? `Partial run: ${run.statusReason ?? "work was interrupted"}`
        : "Within all configured budgets.";
  const completeness: Report["summary"]["completeness"] =
    run.status === "completed"
      ? "complete"
      : run.status === "partial"
        ? "partial"
        : run.status === "failed"
          ? "failed"
          : run.status === "cancelled"
            ? "cancelled"
            : "in_progress";

  const coverage = input.plan.coverage.map((c) => {
    const executed: Record<string, number> = {};
    for (const k of c.scenarioKeys) {
      const st = statusByKey.get(k) ?? "not_run";
      executed[st] = (executed[st] ?? 0) + 1;
    }
    return {
      area: c.area,
      journeyKey: c.journeyKey ?? null,
      scenarioKeys: c.scenarioKeys,
      planStatus: c.status,
      executed,
      notes: c.notes,
    };
  });

  const limitations = [
    run.isFake
      ? "The deterministic fake provider generated the plan and recommendations. No real LLM was used; recommendation quality reflects fixed templates."
      : `Plan and recommendations were generated by ${run.provider}${input.plan.model ? ` (${input.plan.model})` : ""}; model output can be wrong and must be reviewed.`,
    "Only behaviour exercised by executed scenarios was observed. Absence of a finding is not evidence of correctness.",
    "Blocked or inconclusive scenarios usually indicate automation limits (locators, timing, environment), not necessarily target defects.",
    "Automated accessibility checks cover a subset of WCAG 2.2 success criteria and cannot assess many manual criteria.",
    "Timing values are from a single synthetic browser session and are not real-user performance data.",
    "Business rules and permissions not stated in the brief were not inferred or tested.",
    ...(completeness !== "complete"
      ? [`This run is ${completeness}; it does not represent complete coverage. ${budgetStatus}`]
      : []),
  ];
  const manualTesting = [
    "Screen-reader walkthrough of core journeys (NVDA/VoiceOver) and keyboard-only operation.",
    "Colour contrast in all themes/states, focus order and visible focus on every interactive element.",
    "Role and permission boundaries with additional synthetic accounts.",
    "Behaviour under slow or failing network conditions and with third-party integrations re-enabled in a safe sandbox.",
    ...input.scenarios
      .filter((s) => s.status === "blocked" || s.status === "inconclusive")
      .map((s) => `Manually verify ${s.key} "${s.title}" (automation ${s.status}).`),
  ];

  const suite = input.scenarios
    .filter((s) => s.status === "failed" || s.priority === "P0")
    .map((s) => ({
      scenarioKey: s.key,
      title: s.title,
      reason:
        s.status === "failed"
          ? "failed in this run: keep as a regression check"
          : "P0 core journey",
    }));
  const retest = [
    ...observed.map(
      (f) => `${f.key}: rerun ${f.scenarioKey ?? "the affected scenario"} after the fix`,
    ),
    ...input.scenarios
      .filter((s) => s.status === "skipped" || s.status === "inconclusive")
      .map((s) => `${s.key}: not conclusively executed; rerun`),
  ];

  const report: Report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    run: {
      id: run.id,
      status: run.status,
      statusReason: run.statusReason,
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      browserProfile: run.config.browserProfile,
      browser: run.browser,
      viewport: run.viewport,
      runPrefix: run.runPrefix,
      rerunOfRunId: run.rerunOfRunId,
      planVersion: input.plan.version,
      budgetExhausted: run.budgetExhausted,
      budgets: run.config.budgets,
      usage: run.budgetUsage,
    },
    target: {
      name: input.target.name,
      baseUrl: input.target.baseUrl,
      buildLabel: input.target.buildLabel,
      environment: "staging",
    },
    provider: { name: run.provider, model: input.plan.model, isFake: run.isFake },
    summary: {
      scenarioCounts: counts,
      tested,
      notTested,
      topFindingKeys: top,
      budgetStatus,
      completeness,
      analysisSummary: run.analysisSummary,
    },
    coverage,
    unsupportedAreas: input.plan.unsupportedAreas,
    scenarios: input.scenarios.map((s) => ({
      key: s.key,
      version: s.version,
      title: s.title,
      priority: s.priority,
      riskArea: s.riskArea,
      personaKey: s.personaKey,
      journeyKey: s.journeyKey,
      status: s.status,
      reason: s.reason,
      durationMs: s.durationMs,
      steps: (stepsByScenario.get(s.id) ?? []).map((st) => ({
        index: st.index,
        description: st.description,
        status: st.status,
        expected: st.expected,
        actual: st.actual,
        error: st.error,
        url: st.url,
        artifactIds: artByStep.get(st.id) ?? [],
      })),
      artifactIds: artByScenario.get(s.id) ?? [],
    })),
    findings: input.findings,
    uxRecommendations: input.ux,
    agenticOpportunities: input.agentic,
    standards: { observations: standardsObservations(input), disclaimer: DISCLAIMER },
    limitations,
    manualTesting,
    regression: { suite, retest },
    artifacts: input.artifacts.map((a) => ({
      id: a.id,
      kind: a.kind,
      label: a.label,
      scenarioKey: a.scenarioResultId ? (scenarioKeyById.get(a.scenarioResultId) ?? null) : null,
      stepIndex: a.stepResultId ? (stepIndexById.get(a.stepResultId) ?? null) : null,
      sha256: a.sha256,
      sizeBytes: a.sizeBytes,
    })),
  };
  return reportSchema.parse(report);
}

function standardsObservations(input: ReportInput): Report["standards"]["observations"] {
  const out: Report["standards"]["observations"] = [];
  for (const f of input.findings) {
    for (const r of f.standardsRefs) {
      out.push({
        standard: r.standard,
        ref: r.ref,
        observation: f.title,
        basis:
          f.category === "automated_standard_result"
            ? "automated axe-core rule result (review manually)"
            : CATEGORY_LABELS[f.category],
        findingKeys: [f.key],
      });
    }
  }
  // Passive transport/header observations from navigation responses.
  const seen = new Set<string>();
  for (const st of input.steps) {
    const h = st.details?.securityHeaders as Record<string, boolean> | undefined;
    const path = st.url ? safePath(st.url) : "";
    if (!h || seen.has(path)) continue;
    seen.add(path);
    if (st.url?.startsWith("http://")) {
      out.push({
        standard: "OWASP ASVS",
        ref: "V9 Communication (TLS)",
        observation: `${path} was served over plain HTTP in this environment`,
        basis: "passive observation of the staging URL; may be expected for local staging",
        findingKeys: [],
      });
    }
    if (h.csp === false) {
      out.push({
        standard: "OWASP Top 10",
        ref: "A05:2021 Security Misconfiguration",
        observation: `No Content-Security-Policy header on ${path}`,
        basis: "passive response-header observation",
        findingKeys: [],
      });
    }
    if (h.xcto === false) {
      out.push({
        standard: "OWASP ASVS",
        ref: "V14.4 HTTP Security Headers",
        observation: `No X-Content-Type-Options: nosniff on ${path}`,
        basis: "passive response-header observation",
        findingKeys: [],
      });
    }
    if (h.frameProtection === false) {
      out.push({
        standard: "OWASP ASVS",
        ref: "V14.4 HTTP Security Headers",
        observation: `No clickjacking protection (X-Frame-Options or CSP frame-ancestors) on ${path}`,
        basis: "passive response-header observation",
        findingKeys: [],
      });
    }
  }
  const apiErrors = input.findings.filter(
    (f) =>
      f.category === "observed_runtime_symptom" &&
      /\/api\//.test(f.pageUrl ?? f.title) &&
      /Server error 5\d\d/.test(f.title),
  );
  if (apiErrors.length) {
    out.push({
      standard: "OWASP API Security",
      ref: "API8:2023 Security Misconfiguration",
      observation:
        "API endpoint(s) returned unhandled server errors; review error handling and information exposure",
      basis: "observed 5xx responses from /api/ paths",
      findingKeys: apiErrors.map((f) => f.key),
    });
  }
  return out.slice(0, 100);
}

function safePath(u: string): string {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
}

// ---------------------------------------------------------------- rendering

function md(text: string | null | undefined): string {
  return (text ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function findingMarkdown(f: Finding, artifactLabel: (id?: string) => string): string {
  const lines = [
    `### ${f.key} — ${md(f.title)}`,
    "",
    `- **Category:** ${CATEGORY_LABELS[f.category]} · **Severity:** ${f.severity} · **Priority:** ${f.priority} · **Confidence:** ${f.confidence}`,
    `- **Scenario / persona / journey:** ${f.scenarioKey ?? "—"} / ${f.personaKey ?? "—"} / ${f.journeyKey ?? "—"}`,
    `- **Browser / viewport / target version:** ${f.browser ?? "—"} / ${f.viewport ?? "—"} / ${f.targetVersion ?? "—"}`,
    `- **Reproducibility:** ${f.reproducibility.replaceAll("_", " ")} (${f.occurrences} occurrence${f.occurrences === 1 ? "" : "s"})`,
  ];
  if (f.preconditions.length)
    lines.push(`- **Preconditions:** ${f.preconditions.map(md).join("; ")}`);
  lines.push("", md(f.description));
  if (f.reproSteps.length)
    lines.push("", "**Steps to reproduce**", "", ...f.reproSteps.map((s) => `- ${md(s)}`));
  if (f.expected || f.actual)
    lines.push(
      "",
      `**Expected:** ${md(f.expected) || "—"}`,
      "",
      `**Actual:** ${md(f.actual) || "—"}`,
    );
  if (f.evidence.length) {
    lines.push(
      "",
      "**Evidence**",
      "",
      ...f.evidence.map(
        (e) =>
          `- ${e.kind}: ${md(e.description)}${e.artifactId ? ` (artifact ${e.artifactId}${artifactLabel(e.artifactId)})` : ""}`,
      ),
    );
  }
  if (f.standardsRefs.length)
    lines.push(
      "",
      `**Standards references:** ${f.standardsRefs.map((s) => `${s.standard} ${s.ref}`).join(", ")}`,
    );
  if (f.suggestedRegressionTest)
    lines.push("", `**Regression test:** ${md(f.suggestedRegressionTest)}`);
  return lines.join("\n");
}

export function renderMarkdown(r: Report): string {
  const label = (id?: string) => {
    const a = r.artifacts.find((x) => x.id === id);
    return a ? `: ${a.label}` : "";
  };
  const byCat = (cats: string[]) => r.findings.filter((f) => cats.includes(f.category));
  const c = r.summary.scenarioCounts;
  const out: string[] = [
    `# TestApp report: ${md(r.target.name)}`,
    "",
    `- **Run:** ${r.run.id} · **Status:** ${r.run.status} (${r.summary.completeness})`,
    `- **Target:** ${md(r.target.baseUrl)} · **Version:** ${md(r.target.buildLabel) || "unknown"} · **Environment:** staging`,
    `- **Date:** ${r.run.startedAt ?? r.run.createdAt}`,
    `- **Provider:** ${r.provider.name}${r.provider.model ? ` (${r.provider.model})` : ""}${r.provider.isFake ? " — **FAKE PROVIDER: deterministic fixtures, no real LLM**" : ""}`,
    `- **Browser:** ${r.run.browser ?? r.run.browserProfile} · **Viewport:** ${r.run.viewport ?? "—"}`,
    "",
    "## 1. Executive summary",
    "",
    `Scenarios: ${c.passed} passed, ${c.failed} failed, ${c.blocked} blocked, ${c.skipped} skipped, ${c.inconclusive} inconclusive.`,
    "",
    `**Budget / cancellation:** ${md(r.summary.budgetStatus)}`,
    ...(r.run.statusReason ? ["", `**Status detail:** ${md(r.run.statusReason)}`] : []),
    "",
    "**Highest-priority observed findings:**",
    "",
    ...(r.summary.topFindingKeys.length
      ? r.summary.topFindingKeys.map((k) => {
          const f = r.findings.find((x) => x.key === k)!;
          return `- ${k} (${f.priority}, ${CATEGORY_LABELS[f.category]}): ${md(f.title)}`;
        })
      : ["- None observed in executed scenarios."]),
    "",
    "**What was tested:**",
    "",
    ...(r.summary.tested.length
      ? r.summary.tested.map((t) => `- ${md(t)}`)
      : ["- Nothing was executed."]),
    "",
    "**What was not tested:**",
    "",
    ...(r.summary.notTested.length ? r.summary.notTested.map((t) => `- ${md(t)}`) : ["- —"]),
    "",
    "## 2. Coverage matrix",
    "",
    "| Area | Journey | Scenarios | Plan | Executed |",
    "| --- | --- | --- | --- | --- |",
    ...r.coverage.map(
      (row) =>
        `| ${md(row.area)} | ${row.journeyKey ?? "—"} | ${row.scenarioKeys.join(", ") || "—"} | ${row.planStatus} | ${
          Object.entries(row.executed)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ") || "—"
        } |`,
    ),
    ...(r.unsupportedAreas.length
      ? [
          "",
          "Unsupported or insufficiently specified:",
          "",
          ...r.unsupportedAreas.map((u) => `- ${md(u.area)}: ${md(u.reason)}`),
        ]
      : []),
    "",
    "## 3. Bugs and runtime symptoms (evidence-backed)",
    "",
    ...(byCat(["observed_failure", "observed_runtime_symptom"]).map(
      (f) => `${findingMarkdown(f, label)}\n`,
    ) || []),
    ...(byCat(["observed_failure", "observed_runtime_symptom"]).length
      ? []
      : ["No observed failures or runtime symptoms in executed scenarios.", ""]),
    "## 4. UI/UX findings",
    "",
    ...r.uxRecommendations.flatMap((u) => [
      `### ${md(u.title)}`,
      "",
      `- **Affected journey:** ${md(u.affectedJourney)}`,
      `- **User consequence:** ${md(u.userConsequence)}`,
      `- **Current behaviour:** ${md(u.currentBehaviour)}`,
      `- **Recommended change:** ${md(u.recommendedChange)}`,
      `- **Basis:** ${u.basis}${u.basis === "evidence" ? ` (${u.evidenceScenarioKeys.join(", ") || "automated results"})` : " — heuristic, not observed"}: ${md(u.basisDetail)}`,
      `- **Confidence / effort:** ${u.confidence} / ${u.implementationEffort}`,
      "",
    ]),
    ...(r.uxRecommendations.length ? [] : ["None.", ""]),
    "## 5. Agentic opportunities",
    "",
    "_Recommendations, not observed defects._",
    "",
    ...r.agenticOpportunities.flatMap((g) => [
      `### ${md(g.title)}`,
      "",
      `- **User problem / repetitive work removed:** ${md(g.userProblem)}`,
      `- **Trigger:** ${md(g.trigger)} · **Required context:** ${g.requiredContext.map(md).join("; ")}`,
      `- **Tools/actions:** ${g.toolsRequired.map(md).join("; ")}`,
      `- **Autonomy level:** ${g.autonomyLevel.replaceAll("_", " ")}`,
      `- **Permissions and approvals:** ${md(g.permissionsAndApprovals)}`,
      `- **Memory/state:** ${md(g.memoryState)}`,
      `- **Failure recovery / human fallback:** ${md(g.failureRecovery)}`,
      `- **Evaluation criteria:** ${g.evaluationCriteria.map(md).join("; ")}`,
      `- **Value / effort / operational risk:** ${g.expectedValue} / ${g.implementationEffort} / ${g.operationalRisk}`,
      ...(g.deterministicAlternative
        ? [`- **Deterministic alternative:** ${md(g.deterministicAlternative)}`]
        : []),
      `- **Basis:** ${md(g.basis)}`,
      "",
    ]),
    ...(r.agenticOpportunities.length ? [] : ["None.", ""]),
    "## 6. Standards-informed observations",
    "",
    `_${r.standards.disclaimer}_`,
    "",
    ...byCat(["automated_standard_result"]).map((f) => `${findingMarkdown(f, label)}\n`),
    ...r.standards.observations
      .filter((o) => !o.findingKeys.length || o.standard !== "WCAG 2.2")
      .map((o) => `- **${o.standard} ${md(o.ref)}:** ${md(o.observation)} _(${md(o.basis)})_`),
    "",
    "### Heuristic observations and inferred risks (not observed defects)",
    "",
    ...byCat(["heuristic_observation", "inferred_risk"]).map(
      (f) =>
        `- **${f.key} [${CATEGORY_LABELS[f.category]}]** ${md(f.title)} — ${md(f.description.split("\n")[0])}`,
    ),
    "",
    "## 7. Limitations and recommended manual testing",
    "",
    ...r.limitations.map((l) => `- ${md(l)}`),
    "",
    "**Recommended manual testing:**",
    "",
    ...r.manualTesting.map((m) => `- ${md(m)}`),
    "",
    "## 8. Regression suite and retest recommendations",
    "",
    ...r.regression.suite.map((s) => `- ${s.scenarioKey} ${md(s.title)} — ${md(s.reason)}`),
    "",
    "**Retest:**",
    "",
    ...(r.regression.retest.length ? r.regression.retest.map((x) => `- ${md(x)}`) : ["- —"]),
    "",
    "## Artifacts",
    "",
    "| Artifact | Kind | Scenario | Step | SHA-256 |",
    "| --- | --- | --- | --- | --- |",
    ...r.artifacts.map(
      (a) =>
        `| ${a.id} ${md(a.label)} | ${a.kind} | ${a.scenarioKey ?? "—"} | ${a.stepIndex === null ? "—" : a.stepIndex + 1} | ${a.sha256.slice(0, 16)}… |`,
    ),
    "",
  ];
  return out.join("\n");
}

export function renderFixPacket(r: Report): string {
  const label = (id?: string) => {
    const a = r.artifacts.find((x) => x.id === id);
    return a ? `: ${a.label}` : "";
  };
  const observed = r.findings
    .filter((f) => OBSERVED_CATEGORIES.has(f.category))
    .sort(
      (a, b) =>
        PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) ||
        ["observed_failure", "observed_runtime_symptom", "automated_standard_result"].indexOf(
          a.category,
        ) -
          ["observed_failure", "observed_runtime_symptom", "automated_standard_result"].indexOf(
            b.category,
          ),
    );
  const speculative = r.findings.filter((f) => !OBSERVED_CATEGORIES.has(f.category));
  return [
    `# Fix packet: ${md(r.target.name)} (build ${md(r.target.buildLabel) || "unknown"})`,
    "",
    `Generated by TestApp from run ${r.run.id} (${r.run.status}, ${r.summary.completeness}) on ${r.generatedAt}.`,
    `Target: ${md(r.target.baseUrl)} (staging). Browser: ${r.run.browser ?? r.run.browserProfile}, viewport ${r.run.viewport ?? "—"}.`,
    r.provider.isFake
      ? "Planning/recommendations used the deterministic FAKE provider. Observed findings below come from real browser execution."
      : `Provider: ${r.provider.name}.`,
    "",
    "## Instructions for the coding assistant",
    "",
    "You have access to this application's source code; TestApp tested it as a black box and has not seen or changed the source.",
    "",
    "1. Work through the observed findings below in order. For each one, reproduce it using the steps, inspect your own source, and diagnose the root cause before changing code.",
    "2. Fix the root cause, not the symptom, and keep fixes minimal and reviewable.",
    "3. Add or update an automated regression test for each finding (see “Regression tests required”). Do not weaken, skip or delete existing tests.",
    "4. Evidence references are artifact IDs held privately in TestApp; ask the operator for a screenshot or trace if you need it.",
    "5. **Do not blindly trust the speculative section.** Heuristic observations, inferred risks and enhancement ideas were not observed; verify them against product intent before acting.",
    "6. Some failures may be environmental or caused by brittle automation. If you cannot reproduce a finding, say so rather than guessing.",
    "",
    "## Observed findings (ordered by priority)",
    "",
    ...(observed.length
      ? observed.map((f) => `${findingMarkdown(f, label)}\n`)
      : ["No observed findings in this run.", ""]),
    "## Regression tests required",
    "",
    ...(observed.length
      ? observed.map(
          (f) => `- [ ] ${f.key}: ${md(f.suggestedRegressionTest ?? `cover ${f.scenarioKey}`)}`,
        )
      : ["- (none)"]),
    "",
    "## Speculative recommendations — verify before acting",
    "",
    ...(speculative.length
      ? speculative.map((f) => `- ${f.key} [${CATEGORY_LABELS[f.category]}] ${md(f.title)}`)
      : ["- (none)"]),
    "",
    "## Coverage caveats",
    "",
    ...r.summary.notTested.slice(0, 30).map((t) => `- Not tested: ${md(t)}`),
    "",
  ].join("\n");
}

function esc(s: string | number | null | undefined): string {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );
}

/**
 * Self-contained printable HTML. All content is escaped; artifact links point
 * at the authenticated artifact route and only work for the signed-in user.
 */
export function renderHtml(r: Report, opts: { artifactBase?: string } = {}): string {
  const base = opts.artifactBase ?? "/api/artifacts/";
  const link = (id?: string) =>
    id ? `<a href="${esc(base + id)}">${esc(id.slice(0, 8))}</a>` : "";
  const c = r.summary.scenarioCounts;
  const findingHtml = (f: Finding) => `
    <article class="finding ${esc(f.category)}" id="${esc(f.key)}">
      <h3>${esc(f.key)} — ${esc(f.title)}</h3>
      <p class="meta"><span class="cat">${esc(CATEGORY_LABELS[f.category])}</span> · severity ${esc(f.severity)} · ${esc(f.priority)} · confidence ${esc(f.confidence)} · ${esc(f.scenarioKey ?? "")}</p>
      <p>${esc(f.description)}</p>
      ${f.reproSteps.length ? `<h4>Steps to reproduce</h4><ol>${f.reproSteps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
      ${f.expected || f.actual ? `<p><strong>Expected:</strong> ${esc(f.expected)}<br><strong>Actual:</strong> ${esc(f.actual)}</p>` : ""}
      ${f.evidence.length ? `<h4>Evidence</h4><ul>${f.evidence.map((e) => `<li>${esc(e.kind)}: ${esc(e.description)} ${link(e.artifactId)}</li>`).join("")}</ul>` : ""}
      ${f.standardsRefs.length ? `<p class="meta">Standards: ${f.standardsRefs.map((s) => esc(`${s.standard} ${s.ref}`)).join(", ")}</p>` : ""}
      ${f.suggestedRegressionTest ? `<p class="meta">Regression test: ${esc(f.suggestedRegressionTest)}</p>` : ""}
    </article>`;
  const section = (title: string, body: string) =>
    `<section><h2>${esc(title)}</h2>${body}</section>`;
  const cats = (cs: string[]) => r.findings.filter((f) => cs.includes(f.category));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>TestApp report — ${esc(r.target.name)} — ${esc(r.run.id.slice(0, 8))}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:1000px;margin:1.5rem auto;padding:0 1rem;color:#1b1f24;line-height:1.45}
h1{font-size:1.6rem}h2{border-bottom:2px solid #d5dae1;padding-bottom:.2rem;margin-top:2rem}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #d5dae1;padding:.3rem .5rem;text-align:left;vertical-align:top;font-size:.9rem}
.meta{color:#5a6472;font-size:.85rem}.finding{border-left:4px solid #8a94a3;padding:.2rem .8rem;margin:1rem 0}
.observed_failure{border-color:#b42318}.observed_runtime_symptom{border-color:#c2410c}.automated_standard_result{border-color:#8a5a00}
.inferred_risk,.heuristic_observation,.enhancement_opportunity{border-color:#3d4a5c;background:#f6f7f9}
.fake{background:#f3e8ff;border:1px solid #6b2fb3;padding:.5rem;border-radius:6px}
.banner{background:#fff8e6;border-left:4px solid #8a5a00;padding:.5rem .8rem}
@media print{a{color:inherit;text-decoration:none}.finding{break-inside:avoid}}
</style></head><body>
<h1>TestApp report: ${esc(r.target.name)}</h1>
<p class="meta">Run ${esc(r.run.id)} · status <strong>${esc(r.run.status)}</strong> (${esc(r.summary.completeness)}) · ${esc(r.run.startedAt ?? r.run.createdAt)} · version ${esc(r.target.buildLabel ?? "unknown")} · staging · ${esc(r.run.browser ?? r.run.browserProfile)} ${esc(r.run.viewport ?? "")}</p>
${r.provider.isFake ? `<p class="fake"><strong>Fake provider used.</strong> Plan and recommendations came from deterministic fixtures; no real LLM was called. Observed results come from real browser execution.</p>` : `<p class="meta">Provider: ${esc(r.provider.name)} ${esc(r.provider.model ?? "")}</p>`}
${r.summary.completeness !== "complete" ? `<p class="banner">${esc(r.summary.budgetStatus)}</p>` : ""}
${section(
  "1. Executive summary",
  `<p>Scenarios: ${c.passed} passed, ${c.failed} failed, ${c.blocked} blocked, ${c.skipped} skipped, ${c.inconclusive} inconclusive.</p>
  <p><strong>Budget/cancellation:</strong> ${esc(r.summary.budgetStatus)}</p>
  <h3>Highest-priority observed findings</h3><ul>${r.summary.topFindingKeys.map((k) => `<li><a href="#${esc(k)}">${esc(k)}</a> ${esc(r.findings.find((f) => f.key === k)?.title)}</li>`).join("") || "<li>None observed.</li>"}</ul>
  <h3>Tested</h3><ul>${r.summary.tested.map((t) => `<li>${esc(t)}</li>`).join("") || "<li>Nothing executed.</li>"}</ul>
  <h3>Not tested</h3><ul>${r.summary.notTested.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`,
)}
${section(
  "2. Coverage matrix",
  `<table><thead><tr><th>Area</th><th>Journey</th><th>Scenarios</th><th>Plan</th><th>Executed</th></tr></thead><tbody>${r.coverage
    .map(
      (row) =>
        `<tr><td>${esc(row.area)}</td><td>${esc(row.journeyKey ?? "—")}</td><td>${esc(row.scenarioKeys.join(", "))}</td><td>${esc(row.planStatus)}</td><td>${esc(
          Object.entries(row.executed)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", "),
        )}</td></tr>`,
    )
    .join("")}</tbody></table>`,
)}
${section("3. Bugs and runtime symptoms", cats(["observed_failure", "observed_runtime_symptom"]).map(findingHtml).join("") || "<p>None observed.</p>")}
${section(
  "4. UI/UX findings",
  r.uxRecommendations
    .map(
      (u) =>
        `<article class="finding heuristic_observation"><h3>${esc(u.title)}</h3><p><strong>Journey:</strong> ${esc(u.affectedJourney)}<br><strong>Consequence:</strong> ${esc(u.userConsequence)}<br><strong>Current:</strong> ${esc(u.currentBehaviour)}<br><strong>Recommended:</strong> ${esc(u.recommendedChange)}<br><strong>Basis:</strong> ${esc(u.basis)} — ${esc(u.basisDetail)}<br><strong>Confidence/effort:</strong> ${esc(u.confidence)}/${esc(u.implementationEffort)}</p></article>`,
    )
    .join("") || "<p>None.</p>",
)}
${section(
  "5. Agentic opportunities",
  r.agenticOpportunities
    .map(
      (g) =>
        `<article class="finding enhancement_opportunity"><h3>${esc(g.title)}</h3><p>${esc(g.userProblem)}</p><ul><li>Trigger: ${esc(g.trigger)}</li><li>Context: ${esc(g.requiredContext.join("; "))}</li><li>Tools: ${esc(g.toolsRequired.join("; "))}</li><li>Autonomy: ${esc(g.autonomyLevel)}</li><li>Approvals: ${esc(g.permissionsAndApprovals)}</li><li>Memory/state: ${esc(g.memoryState)}</li><li>Failure recovery: ${esc(g.failureRecovery)}</li><li>Evaluation: ${esc(g.evaluationCriteria.join("; "))}</li><li>Value/effort/risk: ${esc(`${g.expectedValue}/${g.implementationEffort}/${g.operationalRisk}`)}</li>${g.deterministicAlternative ? `<li>Deterministic alternative: ${esc(g.deterministicAlternative)}</li>` : ""}</ul></article>`,
    )
    .join("") || "<p>None.</p>",
)}
${section(
  "6. Standards-informed observations",
  `<p class="meta">${esc(r.standards.disclaimer)}</p>${cats(["automated_standard_result"]).map(findingHtml).join("")}<ul>${r.standards.observations
    .filter((o) => o.standard !== "WCAG 2.2")
    .map(
      (o) =>
        `<li><strong>${esc(o.standard)} ${esc(o.ref)}</strong>: ${esc(o.observation)} <span class="meta">(${esc(o.basis)})</span></li>`,
    )
    .join(
      "",
    )}</ul><h3>Heuristic observations and inferred risks (not observed)</h3>${cats(["heuristic_observation", "inferred_risk"]).map(findingHtml).join("") || "<p>None.</p>"}`,
)}
${section("7. Limitations and recommended manual testing", `<ul>${r.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><h3>Manual testing</h3><ul>${r.manualTesting.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>`)}
${section("8. Regression suite and retest", `<ul>${r.regression.suite.map((s) => `<li>${esc(s.scenarioKey)} ${esc(s.title)} — ${esc(s.reason)}</li>`).join("")}</ul><h3>Retest</h3><ul>${r.regression.retest.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`)}
${section(
  "Artifacts",
  `<table><thead><tr><th>ID</th><th>Kind</th><th>Label</th><th>Scenario</th><th>Step</th></tr></thead><tbody>${r.artifacts
    .map(
      (a) =>
        `<tr><td>${link(a.id)}</td><td>${esc(a.kind)}</td><td>${esc(a.label)}</td><td>${esc(a.scenarioKey ?? "—")}</td><td>${a.stepIndex === null ? "—" : a.stepIndex + 1}</td></tr>`,
    )
    .join("")}</tbody></table>`,
)}
</body></html>`;
}
