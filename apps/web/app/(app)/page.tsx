import { listTargets, schema } from "@testapp/db";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Badge, FakeBadge, fmtDate } from "@/components/badge";
import { getDb } from "@/lib/server/context";

export const metadata = { title: "Dashboard · TestApp" };

export default async function Dashboard() {
  const db = getDb();
  const targets = await listTargets(db);
  const recentRuns = await db
    .select({
      id: schema.runs.id,
      status: schema.runs.status,
      createdAt: schema.runs.createdAt,
      isFake: schema.runs.isFake,
      targetName: schema.targets.name,
      browser: schema.runs.browser,
    })
    .from(schema.runs)
    .innerJoin(schema.targets, eq(schema.targets.id, schema.runs.targetId))
    .orderBy(desc(schema.runs.createdAt))
    .limit(10);

  const byProject = new Map<string, typeof targets>();
  for (const t of targets)
    byProject.set(t.projectName, [...(byProject.get(t.projectName) ?? []), t]);

  return (
    <>
      <h1>Dashboard</h1>
      <section aria-labelledby="projects-h">
        <h2 id="projects-h">Projects and targets</h2>
        {targets.length === 0 ? (
          <div className="card">
            <p>No targets yet.</p>
            <Link className="button" href="/targets/new">
              Create your first target
            </Link>
          </div>
        ) : (
          <div className="grid">
            {[...byProject.entries()].map(([project, ts]) => (
              <div className="card" key={project}>
                <h3>{project}</h3>
                <ul>
                  {ts.map((t) => (
                    <li key={t.id}>
                      <Link href={`/targets/${t.id}`}>{t.name}</Link>{" "}
                      <span className="small muted">{t.baseUrl}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
      <section aria-labelledby="runs-h">
        <h2 id="runs-h">Recent runs</h2>
        {recentRuns.length === 0 ? (
          <p className="muted">No runs yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Target</th>
                  <th scope="col">Status</th>
                  <th scope="col">Browser</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/runs/${r.id}`}>{r.id.slice(0, 8)}</Link>{" "}
                      <FakeBadge isFake={r.isFake} />
                    </td>
                    <td>{r.targetName}</td>
                    <td>
                      <Badge value={r.status} />
                    </td>
                    <td>{r.browser ?? "—"}</td>
                    <td>{fmtDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
