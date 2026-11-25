import { getPublicTarget, listBriefVersions, listPlans } from "@testapp/db";
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

      <AutoRefresh active={plans.some((p) => p.status === "generating")} />
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
