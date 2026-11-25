import { CATEGORY_LABELS, OBSERVED_CATEGORIES, TERMINAL_RUN_STATUSES } from "@testapp/core";
import { findingFromRow, getRunDetail, listRuns } from "@testapp/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, FakeBadge, fmtDate } from "@/components/badge";
import { getDb } from "@/lib/server/context";
import { FindingsTable, type FindingView } from "./findings-table";
import { FixPacket } from "./fix-packet";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = getDb();
  const d = await getRunDetail(db, id);
  if (!d) notFound();
  const { run } = d;
  const active = !TERMINAL_RUN_STATUSES.has(run.status);
  const counts: Record<string, number> = {};
  for (const s of d.scenarios) counts[s.status] = (counts[s.status] ?? 0) + 1;
  const findings: FindingView[] = d.findings.map(findingFromRow).map((f) => ({
    key: f.key,
    category: f.category,
    categoryLabel: CATEGORY_LABELS[f.category],
    title: f.title,
    severity: f.severity,
    priority: f.priority,
    confidence: f.confidence,
    scenarioKey: f.scenarioKey ?? null,
    description: f.description,
    expected: f.expected,
    actual: f.actual,
    reproSteps: f.reproSteps,
    evidence: f.evidence.map((e) => ({
      kind: e.kind,
      artifactId: e.artifactId,
      description: e.description,
    })),
    standards: f.standardsRefs.map((s) => `${s.standard} ${s.ref}`),
    regressionTest: f.suggestedRegressionTest,
    observed: OBSERVED_CATEGORIES.has(f.category),
  }));
  const artifactsByStep = new Map<string, typeof d.artifacts>();
  for (const a of d.artifacts)
    if (a.stepResultId)
      artifactsByStep.set(a.stepResultId, [...(artifactsByStep.get(a.stepResultId) ?? []), a]);
  const others = (await listRuns(db, { targetId: run.targetId, limit: 50 })).filter(
    (r) => r.id !== run.id && r.planVersionId === run.planVersionId,
  );
  const reportArtifacts = d.artifacts.filter(
    (a) => a.kind.startsWith("report") || a.kind === "fix_packet",
  );

  return (
    <>
      <p className="small muted">
        <Link href={`/targets/${run.targetId}`}>{d.target.name}</Link> /{" "}
        <Link href={`/plans/${run.planVersionId}`}>Plan v{d.plan.version}</Link> / Run{" "}
        {run.id.slice(0, 8)}
        {run.rerunOfRunId && (
          <>
            {" "}
            (rerun of <Link href={`/runs/${run.rerunOfRunId}`}>{run.rerunOfRunId.slice(0, 8)}</Link>
            )
          </>
        )}
      </p>
      <h1>
        Run <Badge value={run.status} /> <FakeBadge isFake={run.isFake} />
      </h1>
      <AutoRefresh active={active} />
      {run.isFake && (
        <p className="notice info">
          Fake provider: the plan and recommendations are deterministic fixtures. Every scenario
          step was still executed in a real browser; results and observed findings come from that
          execution.
        </p>
      )}
      {run.statusReason && (
        <p
          className={`notice ${run.status === "failed" ? "danger" : ""}`}
          role={run.status === "failed" ? "alert" : undefined}
        >
          {run.statusReason}
        </p>
      )}
      {run.status === "partial" && (
        <p className="notice">
          This run is partial
          {run.budgetExhausted ? ` (budget reached: ${run.budgetExhausted})` : ""}. It does not
          represent complete coverage.
        </p>
      )}
      <div className="card">
        <dl className="grid small">
          <div>
            <dt className="muted">Browser / viewport</dt>
            <dd>
              {run.browser ?? run.config.browserProfile} · {run.viewport ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="muted">Scenarios</dt>
            <dd>
              {Object.entries(counts)
                .map(([k, v]) => `${v} ${k}`)
                .join(", ")}
            </dd>
          </div>
          <div>
            <dt className="muted">Usage</dt>
            <dd>
              {run.budgetUsage
                ? `${run.budgetUsage.totalActions} actions · ${Math.round(run.budgetUsage.elapsedMs / 1000)}s · tokens ${run.budgetUsage.inputTokens}/${run.budgetUsage.outputTokens} · est. cost ${run.budgetUsage.estimatedCostUsd === null ? "n/a (pricing not configured)" : `$${run.budgetUsage.estimatedCostUsd.toFixed(4)}`}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="muted">Run prefix (synthetic data)</dt>
            <dd>
              <code>{run.runPrefix}</code>
            </dd>
          </div>
          <div>
            <dt className="muted">Timing</dt>
            <dd>
              created {fmtDate(run.createdAt)} · finished {fmtDate(run.finishedAt)}
            </dd>
          </div>
        </dl>
        <div className="row no-print">
          {active ? (
            <ActionButton
              url={`/api/runs/${run.id}/cancel`}
              label="Emergency stop"
              busyLabel="Stopping…"
              className="danger"
              confirmText="Stop this run now?"
            />
          ) : (
            <ActionButton
              url={`/api/runs/${run.id}/rerun`}
              label="Rerun same plan"
              busyLabel="Queuing…"
              redirectTo="/runs/{runId}"
            />
          )}
          {!active && others.length > 0 && (
            <Link
              className="button secondary"
              href={`/runs/compare?base=${others[0]!.id}&head=${run.id}`}
            >
              Compare with previous run
            </Link>
          )}
        </div>
      </div>

      {!active && (
        <section className="card" aria-labelledby="exports-h">
          <h2 id="exports-h">Report and exports</h2>
          {reportArtifacts.length === 0 ? (
            <p className="muted">Report not generated.</p>
          ) : (
            <ul>
              <li>
                <Link href={`/runs/${run.id}/report`}>Interactive report</Link>
              </li>
              <li>
                <a href={`/api/runs/${run.id}/export?format=html`} target="_blank" rel="noreferrer">
                  Printable HTML
                </a>{" "}
                · <a href={`/api/runs/${run.id}/export?format=html&download=1`}>download</a>
              </li>
              <li>
                <a href={`/api/runs/${run.id}/export?format=md&download=1`}>Markdown</a>
              </li>
              <li>
                <a href={`/api/runs/${run.id}/export?format=json&download=1`}>
                  JSON (schema-valid)
                </a>
              </li>
            </ul>
          )}
          <h3>Fix packet</h3>
          <FixPacket runId={run.id} />
        </section>
      )}

      <section aria-labelledby="findings-h">
        <h2 id="findings-h">Findings ({findings.length})</h2>
        <p className="small muted">
          Observed categories come only from executed steps, browser events and automated checks.
          Heuristic observations, inferred risks and enhancement opportunities are recommendations,
          not observed bugs.
        </p>
        {findings.length ? (
          <FindingsTable findings={findings} />
        ) : (
          <p className="muted">{active ? "Findings appear after analysis." : "No findings."}</p>
        )}
      </section>

      <section aria-labelledby="scen-h">
        <h2 id="scen-h">Scenario results</h2>
        {d.scenarios.map((s) => {
          const steps = d.steps.filter((st) => st.scenarioResultId === s.id);
          const sArts = d.artifacts.filter((a) => a.scenarioResultId === s.id && !a.stepResultId);
          return (
            <details
              className="card"
              key={s.id}
              open={s.status === "failed" || s.status === "running"}
            >
              <summary>
                {s.scenarioKey} v{s.scenarioVersion} <Badge value={s.status} /> {s.title}{" "}
                {s.durationMs !== null && (
                  <span className="small muted">{(s.durationMs / 1000).toFixed(1)}s</span>
                )}
              </summary>
              {s.reason && <p className="small">{s.reason}</p>}
              {!active && (
                <div className="no-print">
                  <ActionButton
                    url={`/api/runs/${run.id}/rerun`}
                    body={{ scenarioKeys: [s.scenarioKey] }}
                    label={`Rerun ${s.scenarioKey} only`}
                    className="secondary"
                    redirectTo="/runs/{runId}"
                  />
                </div>
              )}
              {steps.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col">Step</th>
                        <th scope="col">Result</th>
                        <th scope="col">Expected / actual</th>
                        <th scope="col">Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {steps.map((st) => (
                        <tr key={st.id}>
                          <td>{st.index + 1}</td>
                          <td className="small">
                            {st.description}
                            <br />
                            <span className="muted">{st.url}</span>
                          </td>
                          <td>
                            <Badge value={st.status} />
                            {st.error && <div className="small error">{st.error}</div>}
                          </td>
                          <td className="small">
                            {st.expected && <div>Expected: {st.expected}</div>}
                            {st.actual && <div>Actual: {st.actual}</div>}
                          </td>
                          <td className="small">
                            {(artifactsByStep.get(st.id) ?? []).map((a) => (
                              <div key={a.id}>
                                {a.kind === "screenshot" ? (
                                  <a
                                    href={`/api/artifacts/${a.id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {/* biome-ignore lint/performance/noImgElement: private authenticated artifact */}
                                    <img
                                      className="thumb"
                                      src={`/api/artifacts/${a.id}`}
                                      alt={`Screenshot: ${a.label}`}
                                      loading="lazy"
                                    />
                                  </a>
                                ) : (
                                  <a
                                    href={`/api/artifacts/${a.id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {a.kind}: {a.label}
                                  </a>
                                )}
                              </div>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {sArts.length > 0 && (
                <p className="small">
                  Scenario artifacts:{" "}
                  {sArts.map((a) => (
                    <span key={a.id}>
                      <a
                        href={`/api/artifacts/${a.id}${a.kind === "trace" ? "?download=1" : ""}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {a.label}
                      </a>{" "}
                    </span>
                  ))}
                </p>
              )}
              {s.browserEvents.length > 0 && (
                <details>
                  <summary>Browser events ({s.browserEvents.length})</summary>
                  <ul className="small">
                    {s.browserEvents.map((e, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: events are positional
                      <li key={i}>
                        [{e.type}] {e.message} {e.url && <span className="muted">{e.url}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </details>
          );
        })}
      </section>

      <section aria-labelledby="events-h">
        <details>
          <summary id="events-h">Run events ({d.events.length})</summary>
          <ul className="small">
            {d.events.map((e) => (
              <li key={e.id}>
                {fmtDate(e.createdAt)} [{e.level}] {e.type}: {e.message}
              </li>
            ))}
          </ul>
        </details>
      </section>
    </>
  );
}
