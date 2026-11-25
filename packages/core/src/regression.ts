import { type FindingCategory, OBSERVED_CATEGORIES } from "./schemas/findings";

/**
 * Regression comparison between two runs using stable scenario keys/versions
 * and finding fingerprints. A finding is only "resolved" when the scenario
 * that produced it was rerun (same key and version) and passed. Absence from a
 * different or incomplete plan is "not_retested", never "resolved".
 */
export type CompareScenario = { key: string; version: number; title: string; status: string };
export type CompareFinding = {
  key: string;
  fingerprint: string;
  category: FindingCategory;
  title: string;
  scenarioKey?: string | null;
};
export type CompareRun = { id: string; scenarios: CompareScenario[]; findings: CompareFinding[] };

export type FindingComparison = {
  status: "new" | "persistent" | "regressed" | "resolved" | "not_retested";
  fingerprint: string;
  title: string;
  category: FindingCategory;
  baseKey: string | null;
  headKey: string | null;
  scenarioKey: string | null;
  note: string;
};

export type ScenarioComparison = {
  key: string;
  title: string;
  baseStatus: string | null;
  headStatus: string | null;
  change:
    | "unchanged"
    | "regressed"
    | "fixed"
    | "changed"
    | "definition_changed"
    | "not_retested"
    | "new_scenario";
};

const EXECUTED = new Set(["passed", "failed"]);

export function compareRuns(
  base: CompareRun,
  head: CompareRun,
): { scenarios: ScenarioComparison[]; findings: FindingComparison[] } {
  const bS = new Map(base.scenarios.map((s) => [s.key, s]));
  const hS = new Map(head.scenarios.map((s) => [s.key, s]));
  const scenarios: ScenarioComparison[] = [];
  for (const key of [...new Set([...bS.keys(), ...hS.keys()])].sort()) {
    const b = bS.get(key);
    const h = hS.get(key);
    let change: ScenarioComparison["change"];
    if (b && !h) change = "not_retested";
    else if (!b && h) change = "new_scenario";
    else if (b!.version !== h!.version) change = "definition_changed";
    else if (b!.status === h!.status) change = "unchanged";
    else if (b!.status === "passed" && h!.status === "failed") change = "regressed";
    else if (b!.status === "failed" && h!.status === "passed") change = "fixed";
    else change = "changed";
    scenarios.push({
      key,
      title: (h ?? b)!.title,
      baseStatus: b?.status ?? null,
      headStatus: h?.status ?? null,
      change,
    });
  }

  const observed = (fs: CompareFinding[]) => fs.filter((f) => OBSERVED_CATEGORIES.has(f.category));
  const bF = new Map(observed(base.findings).map((f) => [f.fingerprint, f]));
  const hF = new Map(observed(head.findings).map((f) => [f.fingerprint, f]));
  const sameScenario = (k: string | null | undefined) => {
    if (!k) return null;
    const b = bS.get(k);
    const h = hS.get(k);
    return b && h && b.version === h.version ? { b, h } : null;
  };
  const findings: FindingComparison[] = [];
  for (const [fp, h] of hF) {
    const b = bF.get(fp);
    if (b) {
      findings.push({
        status: "persistent",
        fingerprint: fp,
        title: h.title,
        category: h.category,
        baseKey: b.key,
        headKey: h.key,
        scenarioKey: h.scenarioKey ?? null,
        note: "observed in both runs",
      });
      continue;
    }
    const pair = sameScenario(h.scenarioKey);
    const regressed = pair?.b.status === "passed";
    findings.push({
      status: regressed ? "regressed" : "new",
      fingerprint: fp,
      title: h.title,
      category: h.category,
      baseKey: null,
      headKey: h.key,
      scenarioKey: h.scenarioKey ?? null,
      note: regressed
        ? "the same scenario passed in the base run"
        : pair
          ? "not observed in the base run"
          : "the base run did not execute a comparable scenario",
    });
  }
  for (const [fp, b] of bF) {
    if (hF.has(fp)) continue;
    const pair = sameScenario(b.scenarioKey);
    const resolved = pair?.h.status === "passed";
    findings.push({
      status: resolved ? "resolved" : "not_retested",
      fingerprint: fp,
      title: b.title,
      category: b.category,
      baseKey: b.key,
      headKey: null,
      scenarioKey: b.scenarioKey ?? null,
      note: resolved
        ? "the producing scenario was rerun with the same definition and passed"
        : !pair
          ? "the producing scenario was not rerun with the same definition"
          : EXECUTED.has(pair.h.status)
            ? "the scenario was rerun but did not pass, so resolution cannot be confirmed"
            : `the scenario was ${pair.h.status} in the head run`,
    });
  }
  const order = { regressed: 0, new: 1, persistent: 2, not_retested: 3, resolved: 4 } as const;
  findings.sort((a, b) => order[a.status] - order[b.status] || a.title.localeCompare(b.title));
  return { scenarios, findings };
}
