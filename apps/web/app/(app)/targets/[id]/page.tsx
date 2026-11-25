import { getPublicTarget, listBriefVersions, listPlans, listRuns, schema } from "@testapp/db";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, FakeBadge, fmtDate } from "@/components/badge";
import { getDb } from "@/lib/server/context";
import { BriefForm, CredentialForm, SettingsForm } from "./target-forms";

export default async function TargetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = getDb();
  const target = await getPublicTarget(db, id);
  if (!target) notFound();
  const briefs = await listBriefVersions(db, id);
  const latest = briefs[0];
  const plans = await listPlans(db, id);
  const preflights = await db
    .select()
    .from(schema.preflights)
    .where(eq(schema.preflights.targetId, id))
    .orderBy(desc(schema.preflights.createdAt))
    .limit(5);
  const runs = await listRuns(db, { targetId: id, limit: 20 });
  const lastPf = preflights[0];

  return (
    <>
      <p className="small muted">Project: {target.projectName}</p>
      <h1>{target.name}</h1>
      <div className="card">
        <dl className="grid small">
          <div>
            <dt className="muted">Base URL</dt>
            <dd>{target.baseUrl}</dd>
          </div>
          <div>
            <dt className="muted">Allowlisted origins</dt>
            <dd>{target.allowedOrigins.join(", ")}</dd>
          </div>
          <div>
            <dt className="muted">Authentication</dt>
            <dd>
              {target.authMode === "form" ? `Form login (${target.loginUrl})` : "None"} ·{" "}
              {target.hasCredential ? "credential stored" : "no credential"}
            </dd>
          </div>
          <div>
            <dt className="muted">Disposable writes</dt>
            <dd>
              {target.allowDisposableWrites
                ? "Allowed (run-prefixed records only)"
                : "Not allowed (read-only)"}
            </dd>
          </div>
          <div>
            <dt className="muted">Build label</dt>
            <dd>{target.buildLabel ?? "—"}</dd>
          </div>
          <div>
            <dt className="muted">Authorisation confirmed</dt>
            <dd>{fmtDate(target.authorizationConfirmedAt)}</dd>
          </div>
        </dl>
      </div>

      <AutoRefresh
        active={
          plans.some((p) => p.status === "generating") ||
          preflights.some((p) => p.status === "queued" || p.status === "running")
        }
      />
      <section aria-labelledby="pf-h" className="card">
        <h2 id="pf-h">Preflight</h2>
        <p className="small muted">
          Verifies the allowlist, reachability, HTML response, redirects, login, the post-login
          start page, browser and storage, then runs a bounded discovery pass.
        </p>
        <ActionButton
          url={`/api/targets/${id}/preflight`}
          label="Run preflight"
          busyLabel="Queuing…"
        />
        {lastPf ? (
          <div>
            <h3>
              Latest:{" "}
              <Badge
                value={
                  lastPf.status === "passed"
                    ? "ok"
                    : lastPf.status === "failed"
                      ? "failed"
                      : "running"
                }
                label={lastPf.status}
              />{" "}
              <span className="small muted">{fmtDate(lastPf.createdAt)}</span>
            </h3>
            {lastPf.error && (
              <p className="notice danger" role="alert">
                {lastPf.error}
              </p>
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Check</th>
                    <th scope="col">Result</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {lastPf.checks.map((c) => (
                    <tr key={c.name}>
                      <td>{c.name}</td>
                      <td>
                        <Badge
                          value={
                            c.status === "passed"
                              ? "ok"
                              : c.status === "failed"
                                ? "failed"
                                : "skipped"
                          }
                          label={c.status}
                        />
                      </td>
                      <td className="small">{c.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {lastPf.discovery && (
              <details>
                <summary>
                  Discovery ({lastPf.discovery.pages.length} pages — untrusted page content)
                </summary>
                <ul className="small">
                  {lastPf.discovery.pages.map((p) => (
                    <li key={p.path}>
                      <code>{p.path}</code> — {p.title} · headings:{" "}
                      {p.headings.slice(0, 4).join(" | ")} · forms: {p.forms.length}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ) : (
          <p className="muted">No preflight yet.</p>
        )}
      </section>
      <section aria-labelledby="runs-h" className="card">
        <h2 id="runs-h">Runs</h2>
        {runs.length === 0 ? (
          <p className="muted">No runs yet. Open a ready plan to start one.</p>
        ) : (
          <ul>
            {runs.map((r) => (
              <li key={r.id}>
                <Link href={`/runs/${r.id}`}>{r.id.slice(0, 8)}</Link> <Badge value={r.status} />{" "}
                plan v{r.planVersion} · {r.config.browserProfile}{" "}
                <span className="small muted">{fmtDate(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="plans-h" className="card">
        <h2 id="plans-h">Test plans</h2>
        <ActionButton
          url={`/api/targets/${id}/plans`}
          label="Generate plan"
          busyLabel="Queuing…"
          redirectTo="/plans/{planId}"
        />
        {plans.length === 0 ? (
          <p className="muted">
            No plans yet. Generating a plan uses the configured LLM provider; run a preflight first
            so discovery data is available.
          </p>
        ) : (
          <ul>
            {plans.map((p) => (
              <li key={p.id}>
                <Link href={`/plans/${p.id}`}>Plan v{p.version}</Link>{" "}
                <Badge
                  value={p.status === "ready" ? "ok" : p.status === "failed" ? "failed" : "running"}
                  label={p.status}
                />{" "}
                <FakeBadge isFake={p.isFake} />{" "}
                <span className="small muted">{fmtDate(p.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="brief-h" className="card">
        <h2 id="brief-h">Brief (version {latest?.version ?? 0})</h2>
        <p className="small muted">
          Versions: {briefs.map((b) => `v${b.version} (${fmtDate(b.createdAt)})`).join(", ")}
        </p>
        <BriefForm targetId={id} current={latest?.content ?? ""} />
      </section>

      <section aria-labelledby="cred-h" className="card">
        <h2 id="cred-h">Synthetic credential</h2>
        <CredentialForm targetId={id} hasCredential={target.hasCredential} />
      </section>

      <section aria-labelledby="settings-h" className="card">
        <h2 id="settings-h">Settings</h2>
        <SettingsForm
          targetId={id}
          s={{
            baseUrl: target.baseUrl,
            allowedOrigins: target.allowedOrigins,
            allowDisposableWrites: target.allowDisposableWrites,
            allowPrivateNetwork: target.allowPrivateNetwork,
            buildLabel: target.buildLabel,
            startPath: target.startPath,
            forbiddenRoutes: target.forbiddenRoutes,
            forbiddenSelectors: target.forbiddenSelectors,
            prohibitedActionsSummary: target.prohibitedActionsSummary,
          }}
        />
      </section>
    </>
  );
}
