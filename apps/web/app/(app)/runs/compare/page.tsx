import { CATEGORY_LABELS, compareRuns } from "@testapp/core";
import { getRunDetail } from "@testapp/db";
import Link from "next/link";
import { Badge } from "@/components/badge";
import { getDb } from "@/lib/server/context";

export const metadata = { title: "Compare runs · TestApp" };

const UUID = /^[0-9a-f-]{36}$/;

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ base?: string; head?: string }>;
}) {
  const { base, head } = await searchParams;
  if (!base || !head || !UUID.test(base) || !UUID.test(head)) {
    return (
      <>
        <h1>Compare runs</h1>
        <p className="muted">
          Choose two runs of the same target (open a run and use “Compare with previous run”).
        </p>
      </>
    );
  }
  const db = getDb();
  const [b, h] = await Promise.all([getRunDetail(db, base), getRunDetail(db, head)]);
  if (!b || !h) return <p role="alert">Run not found.</p>;
  if (b.run.targetId !== h.run.targetId)
    return <p role="alert">These runs belong to different targets and cannot be compared.</p>;
  const toCompare = (d: NonNullable<typeof b>) => ({
    id: d.run.id,
    scenarios: d.scenarios.map((s) => ({
      key: s.scenarioKey,
      version: s.scenarioVersion,
      title: s.title,
      status: s.status,
    })),
    findings: d.findings.map((f) => ({
      key: f.key,
      fingerprint: f.fingerprint,
      category: f.category,
      title: f.title,
      scenarioKey: f.scenarioKey,
    })),
  });
  const cmp = compareRuns(toCompare(b), toCompare(h));
  const statusClass = {
    regressed: "failed",
    new: "failed",
    persistent: "warn",
    not_retested: "info",
    resolved: "ok",
  } as const;
  return (
    <>
      <h1>Compare runs</h1>
      <p className="small">
        Base <Link href={`/runs/${b.run.id}`}>{b.run.id.slice(0, 8)}</Link> ({b.run.status}, plan v
        {b.plan.version}, {b.run.config.browserProfile}) → Head{" "}
        <Link href={`/runs/${h.run.id}`}>{h.run.id.slice(0, 8)}</Link> ({h.run.status}, plan v
        {h.plan.version}, {h.run.config.browserProfile})
      </p>
      {b.run.planVersionId !== h.run.planVersionId && (
        <p className="notice">
          Different plan versions: only scenarios with the same key and version are comparable.
        </p>
      )}
      {b.run.config.browserProfile !== h.run.config.browserProfile && (
        <p className="notice">
          Different browser profiles: differences may be profile-specific rather than regressions.
        </p>
      )}
      <h2>Observed findings</h2>
      {cmp.findings.length === 0 ? (
        <p className="muted">No observed findings in either run.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Finding</th>
                <th scope="col">Category</th>
                <th scope="col">Scenario</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {cmp.findings.map((f) => (
                <tr key={f.fingerprint}>
                  <td>
                    <Badge value={statusClass[f.status]} label={f.status.replace("_", " ")} />
                  </td>
                  <td>
                    {f.headKey ?? f.baseKey} {f.title}
                  </td>
                  <td className="small">{CATEGORY_LABELS[f.category]}</td>
                  <td>{f.scenarioKey ?? "—"}</td>
                  <td className="small">{f.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2>Scenarios</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col">Base</th>
              <th scope="col">Head</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {cmp.scenarios.map((s) => (
              <tr key={s.key}>
                <td>
                  {s.key} {s.title}
                </td>
                <td>{s.baseStatus ? <Badge value={s.baseStatus} /> : "—"}</td>
                <td>{s.headStatus ? <Badge value={s.headStatus} /> : "—"}</td>
                <td className="small">{s.change.replaceAll("_", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
