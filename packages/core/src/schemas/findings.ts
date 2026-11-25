import { z } from "zod";
import { PRIORITIES } from "./plan";

export const FINDING_CATEGORIES = [
  "observed_failure",
  "observed_runtime_symptom",
  "automated_standard_result",
  "heuristic_observation",
  "inferred_risk",
  "enhancement_opportunity",
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

/** Categories that assert something actually happened during execution. */
export const OBSERVED_CATEGORIES: ReadonlySet<FindingCategory> = new Set([
  "observed_failure",
  "observed_runtime_symptom",
  "automated_standard_result",
]);

export const CATEGORY_LABELS: Record<FindingCategory, string> = {
  observed_failure: "Observed failure",
  observed_runtime_symptom: "Observed runtime symptom",
  automated_standard_result: "Automated standard result",
  heuristic_observation: "Heuristic observation",
  inferred_risk: "Inferred risk (not observed)",
  enhancement_opportunity: "Enhancement opportunity",
};

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export const CONFIDENCES = ["high", "medium", "low"] as const;
export const EVIDENCE_SOURCES = ["execution", "automated_check", "llm_analysis", "brief"] as const;

export const evidenceRefSchema = z
  .object({
    kind: z.enum([
      "assertion",
      "step",
      "screenshot",
      "trace",
      "axe",
      "console",
      "page_error",
      "network",
    ]),
    artifactId: z.string().uuid().optional(),
    scenarioKey: z.string().optional(),
    stepIndex: z.number().int().optional(),
    description: z.string().max(1000),
  })
  .strict();
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const standardRefSchema = z
  .object({
    standard: z.enum([
      "WCAG 2.2",
      "OWASP ASVS",
      "OWASP Top 10",
      "OWASP API Security",
      "Nielsen heuristics",
    ]),
    ref: z.string().max(100),
    title: z.string().max(300),
  })
  .strict();
export type StandardRef = z.infer<typeof standardRefSchema>;

export const findingSchema = z
  .object({
    key: z.string().min(1).max(40),
    fingerprint: z.string().min(8).max(128),
    category: z.enum(FINDING_CATEGORIES),
    title: z.string().min(1).max(300),
    description: z.string().max(4000),
    severity: z.enum(SEVERITIES),
    priority: z.enum(PRIORITIES),
    confidence: z.enum(CONFIDENCES),
    source: z.enum(EVIDENCE_SOURCES),
    scenarioKey: z.string().optional(),
    personaKey: z.string().optional(),
    journeyKey: z.string().optional(),
    preconditions: z.array(z.string().max(500)).default([]),
    reproSteps: z.array(z.string().max(500)).default([]),
    expected: z.string().max(2000).optional(),
    actual: z.string().max(2000).optional(),
    pageUrl: z.string().max(1000).optional(),
    targetVersion: z.string().max(200).optional(),
    browser: z.string().max(100).optional(),
    viewport: z.string().max(50).optional(),
    evidence: z.array(evidenceRefSchema).default([]),
    reproducibility: z
      .enum(["reproduced_once", "reproduced_multiple", "not_reproduced", "not_applicable"])
      .default("not_applicable"),
    occurrences: z.number().int().min(1).default(1),
    suggestedRegressionTest: z.string().max(2000).optional(),
    standardsRefs: z.array(standardRefSchema).default([]),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (OBSERVED_CATEGORIES.has(f.category)) {
      if (f.source === "llm_analysis" || f.source === "brief") {
        ctx.addIssue({
          code: "custom",
          path: ["source"],
          message: `${f.category} must come from execution or an automated check, not ${f.source}`,
        });
      }
      if (f.evidence.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["evidence"],
          message: `${f.category} requires execution evidence`,
        });
      }
    }
  });
export type Finding = z.infer<typeof findingSchema>;
export type FindingInput = z.input<typeof findingSchema>;

export const AUTONOMY_LEVELS = [
  "recommend",
  "draft",
  "act_with_approval",
  "bounded_autonomy",
] as const;

export const agenticRecommendationSchema = z
  .object({
    title: z.string().min(1).max(200),
    userProblem: z.string().min(1).max(1000),
    trigger: z.string().min(1).max(500),
    requiredContext: z.array(z.string().max(300)).min(1).max(10),
    toolsRequired: z.array(z.string().max(200)).min(1).max(10),
    autonomyLevel: z.enum(AUTONOMY_LEVELS),
    permissionsAndApprovals: z.string().min(1).max(1000),
    memoryState: z.string().min(1).max(500),
    failureRecovery: z.string().min(1).max(1000),
    evaluationCriteria: z.array(z.string().max(300)).min(1).max(10),
    expectedValue: z.enum(["high", "medium", "low"]),
    implementationEffort: z.enum(["high", "medium", "low"]),
    operationalRisk: z.enum(["high", "medium", "low"]),
    /** When deterministic automation fits better than an agent, say so. */
    deterministicAlternative: z.string().max(1000).optional(),
    basis: z.string().min(1).max(1000),
  })
  .strict();
export type AgenticRecommendation = z.infer<typeof agenticRecommendationSchema>;

export const uxRecommendationSchema = z
  .object({
    title: z.string().min(1).max(200),
    affectedJourney: z.string().max(200),
    userConsequence: z.string().min(1).max(1000),
    currentBehaviour: z.string().min(1).max(1000),
    recommendedChange: z.string().min(1).max(1000),
    basis: z.enum(["evidence", "heuristic"]),
    basisDetail: z.string().min(1).max(1000),
    evidenceScenarioKeys: z.array(z.string()).max(20).default([]),
    confidence: z.enum(CONFIDENCES),
    implementationEffort: z.enum(["high", "medium", "low"]),
    heuristicRef: z.string().max(200).optional(),
  })
  .strict();
export type UxRecommendation = z.infer<typeof uxRecommendationSchema>;

/** What a provider may return from report analysis. It cannot emit observed categories. */
export const analysisOutputSchema = z
  .object({
    uxRecommendations: z.array(uxRecommendationSchema).max(20),
    agenticOpportunities: z.array(agenticRecommendationSchema).max(10),
    inferredRisks: z
      .array(
        z
          .object({
            title: z.string().min(1).max(300),
            description: z.string().min(1).max(2000),
            basis: z.string().min(1).max(1000),
            severity: z.enum(SEVERITIES),
            confidence: z.enum(CONFIDENCES),
            suggestedTest: z.string().max(1000).optional(),
          })
          .strict(),
      )
      .max(20),
    summary: z.string().max(3000),
  })
  .strict();
export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;
