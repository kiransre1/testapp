import { CATEGORY_LABELS, OBSERVED_CATEGORIES, type Report, reportSchema } from "@testapp/core";
import { getRun } from "@testapp/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/badge";
import { getDb } from "@/lib/server/context";

function FindingList({ items }: { items: Report["findings"] }) {
  if (!items.length) return <p className="muted">None.</p>;
  return (
    <>
      {items.map((f) => (
        <article key={f.key} id={f.key} className="card">
          <h4 style={{ marginTop: 0 }}>
            {f.key} — {f.title}
          </h4>
          <p className="small">
            <Badge
              value={OBSERVED_CATEGORIES.has(f.category) ? "failed" : "info"}
              label={CATEGORY_LABELS[f.category]}
            />{" "}
            <Badge value={f.severity} /> {f.priority} · confidence {f.confidence}{" "}
            {f.scenarioKey ? `· ${f.scenarioKey}` : ""}
          </p>
          <p>{f.description}</p>
          {(f.expected || f.actual) && (
            <p className="small">
              <strong>Expected:</strong> {f.expected ?? "—"}
              <br />
              <strong>Actual:</strong> {f.actual ?? "—"}
            </p>
          )}
          {f.reproSteps.length > 0 && (
            <ol className="small">
              {f.reproSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
          {f.evidence.some((e) => e.artifactId) && (
            <p className="small">
              Evidence:{" "}
              {f.evidence
                .filter((e) => e.artifactId)
                .map((e, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional
                  <span key={i}>
                    <a href={`/api/artifacts/${e.artifactId}`} target="_blank" rel="noreferrer">
                      {e.kind}
                    </a>{" "}
                  </span>
                ))}
            </p>
          )}
        </article>
      ))}
    </>
  );
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const run = await getRun(getDb(), id);
  if (!run) notFound();
  const parsed = run.report ? reportSchema.safeParse(run.report) : null;
  if (!parsed?.success) {
    return (
      <>
        <h1>Report</h1>
        <p className="muted">The report for this run has not been generated yet.</p>
        <Link href={`/runs/${id}`}>Back to run</Link>
      </>
    );
  }
  const r = parsed.data;
  const cat = (cs: string[]) => r.findings.filter((f) => cs.includes(f.category));
  const c = r.summary.scenarioCounts;
  return (
    <>
      <p className="small muted no-print">
        <Link href={`/runs/${id}`}>Back to run</Link> ·{" "}
        <a href={`/api/runs/${id}/export?format=html`}>printable HTML</a> ·{" "}
        <a href={`/api/runs/${id}/export?format=md&download=1`}>Markdown</a> ·{" "}
        <a href={`/api/runs/${id}/export?format=json&download=1`}>JSON</a>
      </p>
      <h1>Report: {r.target.name}</h1>
      <p className="small muted">
        Run {r.run.id} · {r.run.status} ({r.summary.completeness}) ·{" "}
        {r.run.startedAt ?? r.run.createdAt} · version {r.target.buildLabel ?? "unknown"} · staging
        · {r.run.browser ?? r.run.browserProfile} {r.run.viewport}
      </p>
      {r.provider.isFake ? (
        <p className="notice info">
          Fake provider used: plan and recommendations are deterministic fixtures. Observed results
          come from real browser execution.
        </p>
      ) : (
        <p className="small">
          Provider: {r.provider.name} {r.provider.model}
        </p>
      )}
      {r.summary.completeness !== "complete" && <p className="notice">{r.summary.budgetStatus}</p>}

      <section>
        <h2>1. Executive summary</h2>
        <p>
          {c.passed} passed · {c.failed} failed · {c.blocked} blocked · {c.skipped} skipped ·{" "}
          {c.inconclusive} inconclusive
        </p>
        <p>
          <strong>Budget / cancellation:</strong> {r.summary.budgetStatus}
        </p>
        <h3>Highest-priority observed findings</h3>
        <ul>
          {r.summary.topFindingKeys.length ? (
            r.summary.topFindingKeys.map((k) => (
              <li key={k}>
                <a href={`#${k}`}>{k}</a> {r.findings.find((f) => f.key === k)?.title}
              </li>
            ))
          ) : (
            <li>None observed.</li>
          )}
        </ul>
        <div className="grid">
          <div>
            <h3>Tested</h3>
            <ul className="small">
              {r.summary.tested.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Not tested</h3>
            <ul className="small">
              {r.summary.notTested.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section>
        <h2>2. Coverage matrix</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Area</th>
                <th scope="col">Journey</th>
                <th scope="col">Scenarios</th>
                <th scope="col">Plan</th>
                <th scope="col">Executed</th>
              </tr>
            </thead>
            <tbody>
              {r.coverage.map((row) => (
                <tr key={row.area}>
                  <td>{row.area}</td>
                  <td>{row.journeyKey ?? "—"}</td>
                  <td>{row.scenarioKeys.join(", ") || "—"}</td>
                  <td>{row.planStatus}</td>
                  <td className="small">
                    {Object.entries(row.executed)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>3. Bugs and runtime symptoms</h2>
        <FindingList items={cat(["observed_failure", "observed_runtime_symptom"])} />
      </section>

      <section>
        <h2>4. UI/UX findings</h2>
        {r.uxRecommendations.length ? (
          r.uxRecommendations.map((u) => (
            <article className="card" key={u.title}>
              <h4 style={{ marginTop: 0 }}>{u.title}</h4>
              <p className="small">
                <strong>Journey:</strong> {u.affectedJourney}
                <br />
                <strong>Consequence:</strong> {u.userConsequence}
                <br />
                <strong>Current:</strong> {u.currentBehaviour}
                <br />
                <strong>Recommended:</strong> {u.recommendedChange}
                <br />
                <strong>Basis:</strong> {u.basis} — {u.basisDetail}
                <br />
                <strong>Confidence / effort:</strong> {u.confidence} / {u.implementationEffort}
              </p>
            </article>
          ))
        ) : (
          <p className="muted">None.</p>
        )}
      </section>

      <section>
        <h2>5. Agentic opportunities</h2>
        {r.agenticOpportunities.length ? (
          r.agenticOpportunities.map((g) => (
            <article className="card" key={g.title}>
              <h4 style={{ marginTop: 0 }}>{g.title}</h4>
              <ul className="small">
                <li>Problem: {g.userProblem}</li>
                <li>Trigger: {g.trigger}</li>
                <li>Context: {g.requiredContext.join("; ")}</li>
                <li>Tools: {g.toolsRequired.join("; ")}</li>
                <li>Autonomy: {g.autonomyLevel.replaceAll("_", " ")}</li>
                <li>Approvals: {g.permissionsAndApprovals}</li>
                <li>Memory/state: {g.memoryState}</li>
                <li>Failure recovery: {g.failureRecovery}</li>
                <li>Evaluation: {g.evaluationCriteria.join("; ")}</li>
                <li>
                  Value / effort / risk: {g.expectedValue} / {g.implementationEffort} /{" "}
                  {g.operationalRisk}
                </li>
                {g.deterministicAlternative && (
                  <li>Deterministic alternative: {g.deterministicAlternative}</li>
                )}
              </ul>
            </article>
          ))
        ) : (
          <p className="muted">None.</p>
        )}
      </section>

      <section>
        <h2>6. Standards-informed observations</h2>
        <p className="small muted">{r.standards.disclaimer}</p>
        <FindingList items={cat(["automated_standard_result"])} />
        <ul className="small">
          {r.standards.observations
            .filter((o) => o.standard !== "WCAG 2.2")
            .map((o, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional
              <li key={i}>
                <strong>
                  {o.standard} {o.ref}
                </strong>
                : {o.observation} <span className="muted">({o.basis})</span>
              </li>
            ))}
        </ul>
        <h3>Heuristic observations and inferred risks (not observed)</h3>
        <FindingList items={cat(["heuristic_observation", "inferred_risk"])} />
      </section>

      <section>
        <h2>7. Limitations and recommended manual testing</h2>
        <ul>
          {r.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <h3>Manual testing</h3>
        <ul>
          {r.manualTesting.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>8. Regression suite and retest</h2>
        <ul>
          {r.regression.suite.map((s) => (
            <li key={s.scenarioKey}>
              {s.scenarioKey} {s.title} — {s.reason}
            </li>
          ))}
        </ul>
        <h3>Retest</h3>
        <ul>
          {r.regression.retest.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
