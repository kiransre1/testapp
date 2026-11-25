import { getPlan, getPublicTarget } from "@testapp/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, FakeBadge, fmtDate } from "@/components/badge";
import { getDb } from "@/lib/server/context";
import { describeAction } from "@/lib/describe";
import { ScenarioJsonEditor, ScenarioToggle } from "./scenario-editor";

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = getDb();
  const data = await getPlan(db, id);
  if (!data) notFound();
  const { plan, personas, journeys, scenarios } = data;
  const target = await getPublicTarget(db, plan.targetId);

  return (
    <>
      <p className="small muted">
        <Link href={`/targets/${plan.targetId}`}>{target?.name ?? "Target"}</Link> / Plan v
        {plan.version}
      </p>
      <h1>
        Test plan v{plan.version}{" "}
        <Badge
          value={plan.status === "ready" ? "ok" : plan.status === "failed" ? "failed" : "running"}
          label={plan.status}
        />{" "}
        <FakeBadge isFake={plan.isFake} />
      </h1>
      <p className="small muted">
        Provider: {plan.provider}
        {plan.model ? ` (${plan.model})` : ""} · created {fmtDate(plan.createdAt)}
        {plan.tokenUsage
          ? ` · tokens in/out ${plan.tokenUsage.inputTokens}/${plan.tokenUsage.outputTokens}`
          : ""}
      </p>
      {plan.isFake && (
        <p className="notice info">
          This plan was produced by the deterministic <strong>fake provider</strong>{" "}
          (fixture/discovery driven). No real LLM was used. Runs still execute every step in a real
          browser.
        </p>
      )}
      <AutoRefresh active={plan.status === "generating"} />
      {plan.status === "failed" && (
        <p className="notice danger" role="alert">
          Plan generation failed: {plan.error}
        </p>
      )}

      {plan.status === "ready" && (
        <>
          <section aria-labelledby="personas-h">
            <h2 id="personas-h">Personas</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Key</th>
                    <th scope="col">Role &amp; permissions</th>
                    <th scope="col">Goal / success</th>
                    <th scope="col">Profile</th>
                    <th scope="col">May not perform</th>
                  </tr>
                </thead>
                <tbody>
                  {personas.map((p) => (
                    <tr key={p.key}>
                      <td>
                        <strong>{p.key}</strong>
                        <br />
                        {p.name}
                      </td>
                      <td>
                        {p.role}
                        <br />
                        <span className="small muted">{p.permissions.join("; ") || "—"}</span>
                      </td>
                      <td>
                        {p.goal}
                        <br />
                        <span className="small muted">{p.successCriterion}</span>
                      </td>
                      <td className="small">
                        {p.deviceProfile}; familiarity {p.productFamiliarity}; tech{" "}
                        {p.technicalConfidence}
                        {p.accessibilityNeeds.length
                          ? `; needs: ${p.accessibilityNeeds.join(", ")}`
                          : ""}
                        <br />
                        Start: {p.startingDataState}
                      </td>
                      <td className="small">{p.mayNotPerform.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="journeys-h">
            <h2 id="journeys-h">Journeys</h2>
            <ul>
              {journeys.map((j) => (
                <li key={j.key}>
                  <strong>{j.key}</strong> {j.title} <Badge value="info" label={j.priority} /> —{" "}
                  <span className="small">{j.summary}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="coverage-h">
            <h2 id="coverage-h">Coverage matrix</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Area</th>
                    <th scope="col">Journey</th>
                    <th scope="col">Scenarios</th>
                    <th scope="col">Status</th>
                    <th scope="col">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.coverage.map((c) => (
                    <tr key={c.area}>
                      <td>{c.area}</td>
                      <td>{c.journeyKey ?? "—"}</td>
                      <td>{c.scenarioKeys.join(", ") || "—"}</td>
                      <td>
                        <Badge
                          value={
                            c.status === "covered" ? "ok" : c.status === "partial" ? "warn" : "info"
                          }
                          label={c.status.replace("_", " ")}
                        />
                      </td>
                      <td className="small">{c.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {plan.unsupportedAreas.length > 0 && (
              <>
                <h3>Unsupported or insufficiently specified</h3>
                <ul>
                  {plan.unsupportedAreas.map((u) => (
                    <li key={u.area}>
                      <strong>{u.area}</strong>: {u.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {plan.assumptions.length > 0 && (
              <>
                <h3>Assumptions</h3>
                <ul>
                  {plan.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section aria-labelledby="scenarios-h">
            <h2 id="scenarios-h">Scenarios ({scenarios.length})</h2>
            {scenarios.map((s) => {
              const d = s.definition;
              return (
                <article className="card" key={s.id} aria-labelledby={`sc-${d.key}`}>
                  <div className="row">
                    <h3 id={`sc-${d.key}`} style={{ margin: 0 }}>
                      {d.key} v{s.version}: {d.title}
                    </h3>
                    <Badge value="info" label={d.priority} />
                    <Badge value="info" label={d.riskArea} />
                    <Badge
                      value={d.dataMode === "read_only" ? "ok" : "warn"}
                      label={d.dataMode.replace("_", " ")}
                    />
                    {d.blockedReason && <Badge value="blocked" label="blocked" />}
                    <span className="spacer" />
                    <ScenarioToggle planId={plan.id} scenarioKey={d.key} enabled={s.enabled} />
                  </div>
                  <p className="small">{d.rationale}</p>
                  <p className="small muted">
                    Persona {d.personaKey} · Journey {d.journeyKey} · start {d.startRoute} ·{" "}
                    {d.requiresAuth ? "authenticated" : "signed out"} · max {d.maxActions} actions ·
                    prohibited class: {d.prohibitedActionClass}
                    {d.blockedReason ? ` · blocked: ${d.blockedReason}` : ""}
                  </p>
                  <ol className="small">
                    {d.steps.map((st, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: steps are positional
                      <li key={i}>{describeAction(st)}</li>
                    ))}
                  </ol>
                  <p className="small">
                    <strong>Expected:</strong> {d.expectedOutcomes.join("; ")}
                  </p>
                  <details>
                    <summary>Edit steps (JSON)</summary>
                    <ScenarioJsonEditor planId={plan.id} scenarioKey={d.key} initial={d} />
                  </details>
                </article>
              );
            })}
          </section>
        </>
      )}
    </>
  );
}
