import { listRuns, scenarioStatusCounts } from "@testapp/db";
import Link from "next/link";
import { Badge, FakeBadge, fmtDate } from "@/components/badge";
import { getDb } from "@/lib/server/context";

export const metadata = { title: "Runs · TestApp" };

export default async function RunsPage() {
  const db = getDb();
  const runs = await listRuns(db, { limit: 100 });
  const counts = await scenarioStatusCounts(
    db,
    runs.map((r) => r.id),
  );
  const byRun = new Map<string, Record<string, number>>();
  for (const c of counts) byRun.set(c.runId, { ...(byRun.get(c.runId) ?? {}), [c.status]: c.n });
  return (
    <>
      <h1>Runs</h1>
      {runs.length === 0 ? (
        <p className="muted">No runs yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Run</th>
                <th scope="col">Target / plan</th>
                <th scope="col">Status</th>
                <th scope="col">Scenarios</th>
                <th scope="col">Profile</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const c = byRun.get(r.id) ?? {};
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/runs/${r.id}`}>{r.id.slice(0, 8)}</Link>{" "}
                      <FakeBadge isFake={r.isFake} />
                      {r.rerunOfRunId && <span className="small muted"> (rerun)</span>}
                    </td>
                    <td>
                      {r.targetName} · v{r.planVersion}
                    </td>
                    <td>
                      <Badge value={r.status} />
                    </td>
                    <td className="small">
                      {Object.entries(c)
                        .map(([k, v]) => `${v} ${k}`)
                        .join(", ") || "—"}
                    </td>
                    <td className="small">{r.config.browserProfile}</td>
                    <td className="small">{fmtDate(r.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
