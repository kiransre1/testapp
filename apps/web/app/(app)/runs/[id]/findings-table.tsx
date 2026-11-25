"use client";

import { useMemo, useState } from "react";

export type FindingView = {
  key: string;
  category: string;
  categoryLabel: string;
  title: string;
  severity: string;
  priority: string;
  confidence: string;
  scenarioKey: string | null;
  description: string;
  expected?: string;
  actual?: string;
  reproSteps: string[];
  evidence: { kind: string; artifactId?: string; description: string }[];
  standards: string[];
  regressionTest?: string;
  observed: boolean;
};

export function FindingsTable({ findings }: { findings: FindingView[] }) {
  const [cat, setCat] = useState("all");
  const [sev, setSev] = useState("all");
  const [conf, setConf] = useState("all");
  const cats = useMemo(() => [...new Set(findings.map((f) => f.category))], [findings]);
  const shown = findings.filter(
    (f) =>
      (cat === "all" || f.category === cat) &&
      (sev === "all" || f.severity === sev) &&
      (conf === "all" || f.confidence === conf),
  );
  return (
    <div className="stack">
      <fieldset className="row">
        <legend>Filter findings</legend>
        <label className="inline">
          Category
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">All</option>
            {cats.map((c) => (
              <option key={c} value={c}>
                {findings.find((f) => f.category === c)?.categoryLabel}
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          Severity
          <select value={sev} onChange={(e) => setSev(e.target.value)}>
            {["all", "critical", "high", "medium", "low", "info"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="inline">
          Confidence
          <select value={conf} onChange={(e) => setConf(e.target.value)}>
            {["all", "high", "medium", "low"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <span className="small muted" aria-live="polite">
          {shown.length} of {findings.length} shown
        </span>
      </fieldset>
      {shown.map((f) => (
        <details key={f.key} className="card" id={f.key}>
          <summary>
            {f.key} ·{" "}
            <span className={`badge ${f.observed ? "failed" : "info"}`}>{f.categoryLabel}</span>{" "}
            <span className={`badge ${f.severity}`}>{f.severity}</span>{" "}
            <span className="badge info">{f.priority}</span>{" "}
            <span className="small">confidence {f.confidence}</span> — {f.title}
          </summary>
          <p>{f.description}</p>
          {(f.expected || f.actual) && (
            <p className="small">
              <strong>Expected:</strong> {f.expected ?? "—"}
              <br />
              <strong>Actual:</strong> {f.actual ?? "—"}
            </p>
          )}
          {f.reproSteps.length > 0 && (
            <>
              <h4>Steps to reproduce</h4>
              <ul className="small">
                {f.reproSteps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          )}
          {f.evidence.length > 0 && (
            <>
              <h4>Evidence</h4>
              <ul className="small">
                {f.evidence.map((e, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: evidence entries are positional
                  <li key={i}>
                    {e.kind}: {e.description}{" "}
                    {e.artifactId && (
                      <a href={`/api/artifacts/${e.artifactId}`} target="_blank" rel="noreferrer">
                        open artifact
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {f.standards.length > 0 && <p className="small">Standards: {f.standards.join(", ")}</p>}
          {f.regressionTest && <p className="small">Regression test: {f.regressionTest}</p>}
        </details>
      ))}
    </div>
  );
}
