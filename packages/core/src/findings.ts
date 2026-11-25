import { createHash } from "node:crypto";
import { describeAction } from "./describe";
import type {
  AgenticRecommendation,
  AnalysisOutput,
  EvidenceRef,
  Finding,
  FindingCategory,
  StandardRef,
  UxRecommendation,
} from "./schemas/findings";
import { findingSchema } from "./schemas/findings";
import type { Scenario } from "./schemas/plan";

/**
 * Deterministic finding derivation from execution evidence. Observed
 * categories are produced ONLY here, from executed steps, browser events and
 * automated checks. Provider output can only add heuristic observations,
 * inferred risks and enhancement opportunities.
 */

export type AnalyserStep = {
  id: string;
  index: number;
  action: string;
  description: string;
  status: string;
  expected: string | null;
  actual: string | null;
  error: string | null;
  url: string | null;
  details: Record<string, unknown> | null;
};

export type AnalyserScenario = {
  id: string;
  key: string;
  status: string;
  reason: string | null;
  definition: Scenario;
  steps: AnalyserStep[];
  events: {
    type: string;
    message: string;
    url?: string;
    status?: number;
    method?: string;
    step?: number;
  }[];
  /** artifact ids by step result id, and scenario-level artifacts (trace, final screenshot, event log). */
  stepArtifacts: Record<string, { id: string; kind: string }[]>;
  scenarioArtifacts: { id: string; kind: string }[];
};

export type AnalyserRun = {
  runPrefix: string;
  targetVersion: string | null;
  browser: string;
  viewport: string;
  scenarios: AnalyserScenario[];
};

const PRIORITY_SEVERITY = { P0: "high", P1: "medium", P2: "low", P3: "low" } as const;
const IMPACT_SEVERITY: Record<string, Finding["severity"]> = {
  critical: "high",
  serious: "medium",
  moderate: "low",
  minor: "info",
};
const SEVERITY_PRIORITY: Record<Finding["severity"], Finding["priority"]> = {
  critical: "P0",
  high: "P1",
  medium: "P2",
  low: "P3",
  info: "P3",
};
const CATEGORY_ORDER: FindingCategory[] = [
  "observed_failure",
  "observed_runtime_symptom",
  "automated_standard_result",
  "heuristic_observation",
  "inferred_risk",
  "enhancement_opportunity",
];

export function fingerprint(parts: string[]): string {
  return createHash("sha256").update(parts.join("␟")).digest("hex").slice(0, 32);
}

/** Normalise volatile text (run prefixes, numbers, ids, urls) so fingerprints are stable across runs. */
export function normaliseForFingerprint(text: string, runPrefix?: string): string {
  let t = text;
  if (runPrefix) t = t.split(runPrefix).join("{{run}}");
  return t
    .replace(/TA-[A-Z2-9]{6}/g, "{{run}}")
    .replace(/https?:\/\/[^\s"')]+/g, "<url>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function pathOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Map axe WCAG tags (e.g. wcag111, wcag412) to WCAG 2.2 references. */
export function wcagRefs(tags: string[], title: string): StandardRef[] {
  const refs: StandardRef[] = [];
  for (const t of tags) {
    const m = /^wcag(\d)(\d)(\d+)$/.exec(t);
    if (m) refs.push({ standard: "WCAG 2.2", ref: `SC ${m[1]}.${m[2]}.${m[3]}`, title });
  }
  return refs;
}

function reproSteps(s: Scenario, uptoIndex: number): string[] {
  const steps = s.steps
    .slice(0, uptoIndex + 1)
    .map((st, i) => `${i + 1}. ${st.description ?? describeAction(st)}`);
  return [
    `Start at ${s.startRoute}${s.requiresAuth ? " signed in with the synthetic account" : " signed out"}`,
    ...steps,
  ];
}

type Draft = Omit<Finding, "key">;

function merge(map: Map<string, Draft>, d: Draft) {
  const existing = map.get(d.fingerprint);
  if (!existing) {
    map.set(d.fingerprint, d);
    return;
  }
  existing.occurrences += d.occurrences;
  existing.evidence = [...existing.evidence, ...d.evidence].slice(0, 30);
  existing.reproducibility = "reproduced_multiple";
}

export function deriveObservedFindings(run: AnalyserRun): Finding[] {
  const drafts = new Map<string, Draft>();
  for (const sc of run.scenarios) {
    const def = sc.definition;
    const common = {
      scenarioKey: sc.key,
      personaKey: def.personaKey,
      journeyKey: def.journeyKey,
      preconditions: def.preconditions,
      targetVersion: run.targetVersion ?? undefined,
      browser: run.browser,
      viewport: run.viewport,
      standardsRefs: [] as StandardRef[],
    };
    const traceRefs: EvidenceRef[] = sc.scenarioArtifacts
      .filter((a) => a.kind === "trace")
      .map((a) => ({
        kind: "trace" as const,
        artifactId: a.id,
        scenarioKey: sc.key,
        description: "Playwright trace of the scenario",
      }));

    for (const st of sc.steps) {
      const arts = sc.stepArtifacts[st.id] ?? [];
      const shots: EvidenceRef[] = arts
        .filter((a) => a.kind === "screenshot")
        .map((a) => ({
          kind: "screenshot" as const,
          artifactId: a.id,
          scenarioKey: sc.key,
          stepIndex: st.index,
          description: `Screenshot at step ${st.index + 1}`,
        }));

      // 1. Failed application-level assertions -> observed failures.
      if (st.status === "failed" && st.details?.assertion) {
        const weakOracle = (st.actual ?? "").includes("no matching element");
        const severity = PRIORITY_SEVERITY[def.priority];
        merge(drafts, {
          ...common,
          fingerprint: fingerprint([
            "observed_failure",
            sc.key,
            st.action,
            normaliseForFingerprint(st.expected ?? st.description, run.runPrefix),
          ]),
          category: "observed_failure",
          title: `${def.title}: ${normaliseTitle(st.description, run.runPrefix)}`.slice(0, 300),
          description:
            `During ${sc.key} the assertion "${st.description}" failed. ${sc.reason ?? ""}`.trim(),
          severity,
          priority: def.priority,
          confidence: weakOracle ? "medium" : "high",
          source: "execution",
          reproSteps: reproSteps(def, st.index),
          expected: st.expected ?? undefined,
          actual: st.actual ?? undefined,
          pageUrl: st.url ?? undefined,
          evidence: [
            {
              kind: "assertion",
              scenarioKey: sc.key,
              stepIndex: st.index,
              description: `Expected ${st.expected ?? "?"}; actual ${st.actual ?? "?"}`,
            },
            ...shots,
            ...traceRefs,
          ],
          reproducibility: "reproduced_once",
          occurrences: 1,
          suggestedRegressionTest: `Automate ${sc.key} ("${def.title}") and assert: ${st.expected ?? st.description}.`,
        });
      }

      // 2. Automated accessibility rule results.
      const axe = st.details?.axe;
      if (st.details?.automatedCheck && Array.isArray(axe)) {
        const axeArtifact = arts.find((a) => a.kind === "axe");
        for (const v of axe as {
          id: string;
          impact: string;
          help: string;
          count: number;
          tags: string[];
        }[]) {
          const p = pathOf(st.url);
          const severity = IMPACT_SEVERITY[v.impact] ?? "low";
          merge(drafts, {
            ...common,
            fingerprint: fingerprint(["axe", v.id, p]),
            category: "automated_standard_result",
            title: `Accessibility rule "${v.id}" violated on ${p || "page"}: ${v.help}`.slice(
              0,
              300,
            ),
            description: `axe-core reported ${v.count} element(s) violating "${v.id}" (${v.impact}). This is an automated rule result; it does not by itself establish WCAG non-conformance and does not cover manual criteria.`,
            severity,
            priority: SEVERITY_PRIORITY[severity],
            confidence: "high",
            source: "automated_check",
            reproSteps: reproSteps(def, st.index),
            expected: "No elements violate this rule",
            actual: `${v.count} element(s) violate it`,
            pageUrl: st.url ?? undefined,
            standardsRefs: wcagRefs(v.tags ?? [], v.help),
            evidence: [
              ...(axeArtifact
                ? [
                    {
                      kind: "axe" as const,
                      artifactId: axeArtifact.id,
                      scenarioKey: sc.key,
                      stepIndex: st.index,
                      description: "axe-core results (JSON)",
                    },
                  ]
                : []),
              ...shots,
            ],
            reproducibility: "reproduced_once",
            occurrences: 1,
            suggestedRegressionTest: `Run axe-core on ${p || "the page"} and assert no "${v.id}" violations.`,
          });
        }
      }
    }

    // 3. Runtime symptoms from browser events.
    const eventLog = sc.scenarioArtifacts.find((a) => a.kind === "console_log");
    for (const ev of sc.events) {
      if (ev.type === "blocked_navigation") continue;
      const p = pathOf(ev.url);
      let severity: Finding["severity"];
      let title: string;
      if (ev.type === "page_error") {
        severity = "medium";
        title = `Uncaught page error on ${p}: ${ev.message}`;
      } else if (ev.type === "console") {
        severity = "low";
        title = `Console error on ${p}: ${ev.message}`;
      } else if (ev.status && ev.status >= 500) {
        severity = "medium";
        title = `Server error ${ev.status} for ${ev.method ?? "GET"} ${p}`;
      } else if (ev.status && ev.status >= 400) {
        if (ev.status === 401 || ev.status === 403) continue; // expected for unauthenticated checks; not a symptom by itself
        severity = "low";
        title = `HTTP ${ev.status} for ${ev.method ?? "GET"} ${p}`;
      } else {
        severity = "low";
        title = `Network failure for ${ev.method ?? "GET"} ${p}: ${ev.message}`;
      }
      const stepIdx = ev.step ?? -1;
      merge(drafts, {
        ...common,
        fingerprint: fingerprint([
          "runtime",
          ev.type,
          String(ev.status ?? ""),
          p,
          normaliseForFingerprint(ev.message, run.runPrefix),
        ]),
        category: "observed_runtime_symptom",
        title: title.slice(0, 300),
        description: `Observed during ${sc.key}${stepIdx >= 0 ? ` at step ${stepIdx + 1}` : ""}. Runtime symptoms need triage: they may or may not affect users.`,
        severity,
        priority: SEVERITY_PRIORITY[severity],
        confidence: "high",
        source: "execution",
        reproSteps: reproSteps(def, Math.max(0, stepIdx)),
        actual: ev.message,
        pageUrl: ev.url,
        evidence: [
          {
            kind:
              ev.type === "page_error"
                ? "page_error"
                : ev.type === "console"
                  ? "console"
                  : "network",
            artifactId: eventLog?.id,
            scenarioKey: sc.key,
            stepIndex: stepIdx >= 0 ? stepIdx : undefined,
            description: `${ev.type}: ${ev.message}`.slice(0, 1000),
          },
        ],
        reproducibility: "reproduced_once",
        occurrences: 1,
        suggestedRegressionTest: `Load ${p} and assert no ${ev.type === "network" ? "failed requests" : "console/page errors"} occur.`,
      });
    }
  }
  return finalise([...drafts.values()]);
}

function normaliseTitle(text: string, runPrefix: string): string {
  return text.split(runPrefix).join("‹run›");
}

/** Convert provider analysis into non-observed findings. Never produces observed categories. */
export function analysisToFindings(a: AnalysisOutput): Draft[] {
  const out: Draft[] = [];
  for (const r of a.inferredRisks) {
    out.push({
      fingerprint: fingerprint(["inferred_risk", normaliseForFingerprint(r.title)]),
      category: "inferred_risk",
      title: r.title,
      description: `${r.description}\n\nBasis: ${r.basis}. This is a hypothesis, not an observed defect.`,
      severity: r.severity,
      priority: SEVERITY_PRIORITY[r.severity],
      confidence: r.confidence,
      source: "llm_analysis",
      preconditions: [],
      reproSteps: [],
      evidence: [],
      reproducibility: "not_applicable",
      occurrences: 1,
      suggestedRegressionTest: r.suggestedTest,
      standardsRefs: [],
    });
  }
  for (const u of a.uxRecommendations) out.push(uxToFinding(u));
  for (const g of a.agenticOpportunities) out.push(agenticToFinding(g));
  return out;
}

function uxToFinding(u: UxRecommendation): Draft {
  return {
    fingerprint: fingerprint(["heuristic_observation", normaliseForFingerprint(u.title)]),
    category: "heuristic_observation",
    title: u.title,
    description: `${u.userConsequence}\n\nCurrent: ${u.currentBehaviour}\nRecommended: ${u.recommendedChange}\nBasis (${u.basis}): ${u.basisDetail}`,
    severity: "low",
    priority: "P3",
    confidence: u.confidence,
    source: "llm_analysis",
    preconditions: [],
    reproSteps: [],
    evidence: u.evidenceScenarioKeys.map((k) => ({
      kind: "step" as const,
      scenarioKey: k,
      description: `Related scenario ${k}`,
    })),
    reproducibility: "not_applicable",
    occurrences: 1,
    standardsRefs: u.heuristicRef?.startsWith("Nielsen")
      ? [{ standard: "Nielsen heuristics", ref: u.heuristicRef.slice(0, 100), title: u.title }]
      : [],
  };
}

function agenticToFinding(g: AgenticRecommendation): Draft {
  return {
    fingerprint: fingerprint(["enhancement_opportunity", normaliseForFingerprint(g.title)]),
    category: "enhancement_opportunity",
    title: g.title,
    description:
      `${g.userProblem}\nAutonomy: ${g.autonomyLevel}. ${g.deterministicAlternative ? `Deterministic alternative: ${g.deterministicAlternative}` : ""}`.trim(),
    severity: "info",
    priority: "P3",
    confidence: "low",
    source: "llm_analysis",
    preconditions: [],
    reproSteps: [],
    evidence: [],
    reproducibility: "not_applicable",
    occurrences: 1,
    standardsRefs: [],
  };
}

/** Assign stable display keys and validate every finding (evidence rules are enforced by the schema). */
export function finalise(drafts: Draft[]): Finding[] {
  const sorted = [...drafts].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      (a.scenarioKey ?? "").localeCompare(b.scenarioKey ?? "") ||
      a.fingerprint.localeCompare(b.fingerprint),
  );
  return sorted.map((d, i) =>
    findingSchema.parse({ ...d, key: `F-${String(i + 1).padStart(3, "0")}` }),
  );
}

/** Combine observed findings with analysis-derived ones, deduplicating by fingerprint. */
export function combineFindings(observed: Finding[], analysis: AnalysisOutput | null): Finding[] {
  const drafts = new Map<string, Draft>();
  for (const f of observed) {
    const { key: _k, ...d } = f;
    drafts.set(d.fingerprint, d);
  }
  if (analysis)
    for (const d of analysisToFindings(analysis))
      if (!drafts.has(d.fingerprint)) drafts.set(d.fingerprint, d);
  return finalise([...drafts.values()]);
}
