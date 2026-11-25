import { buildReport, renderFixPacket, renderHtml, renderMarkdown } from "@testapp/core";
import { findingFromRow, getRunDetail, schema } from "@testapp/db";
import { and, eq, inArray } from "drizzle-orm";
import type { WorkerContext } from "../context";
import { saveArtifact } from "../runner/evidence";

const REPORT_KINDS = ["report_json", "report_md", "report_html", "fix_packet"] as const;

/** Build the schema-valid report and store JSON/Markdown/HTML/fix-packet exports. */
export async function buildAndStoreReports(ctx: WorkerContext, runId: string): Promise<void> {
  const d = await getRunDetail(ctx.db, runId);
  if (!d) return;
  const report = buildReport({
    run: {
      id: d.run.id,
      status: d.run.status,
      statusReason: d.run.statusReason,
      createdAt: d.run.createdAt,
      startedAt: d.run.startedAt,
      finishedAt: d.run.finishedAt,
      config: d.run.config,
      browser: d.run.browser,
      viewport: d.run.viewport,
      runPrefix: d.run.runPrefix,
      rerunOfRunId: d.run.rerunOfRunId,
      budgetExhausted: d.run.budgetExhausted,
      budgetUsage: d.run.budgetUsage ?? null,
      analysisSummary: d.run.analysisSummary,
      provider: d.run.provider,
      isFake: d.run.isFake,
    },
    plan: {
      version: d.plan.version,
      model: d.plan.model,
      coverage: d.plan.coverage,
      unsupportedAreas: d.plan.unsupportedAreas,
    },
    target: {
      name: d.target.name,
      baseUrl: d.target.baseUrl,
      buildLabel: d.run.targetBuildLabel ?? d.target.buildLabel,
    },
    scenarios: d.scenarios.map((s) => ({
      id: s.id,
      key: s.scenarioKey,
      version: s.scenarioVersion,
      title: s.title,
      priority: s.definition.priority,
      riskArea: s.definition.riskArea,
      personaKey: s.definition.personaKey,
      journeyKey: s.definition.journeyKey,
      status: s.status,
      reason: s.reason,
      durationMs: s.durationMs,
    })),
    steps: d.steps,
    artifacts: d.artifacts.filter((a) => !(REPORT_KINDS as readonly string[]).includes(a.kind)),
    findings: d.findings.map(findingFromRow),
    ux: d.recommendations.filter((r) => r.kind === "ux").map((r) => r.data) as never,
    agentic: d.recommendations.filter((r) => r.kind === "agentic").map((r) => r.data) as never,
  });

  // Replace earlier exports for this run (e.g. after an interrupted run is finalised).
  const old = await ctx.db
    .select()
    .from(schema.artifacts)
    .where(
      and(eq(schema.artifacts.runId, runId), inArray(schema.artifacts.kind, [...REPORT_KINDS])),
    );
  for (const a of old) await ctx.store.remove(a.storageKey).catch(() => undefined);
  if (old.length)
    await ctx.db.delete(schema.artifacts).where(
      inArray(
        schema.artifacts.id,
        old.map((a) => a.id),
      ),
    );

  await saveArtifact(ctx, {
    kind: "report_json",
    label: "Report (JSON)",
    data: Buffer.from(JSON.stringify(report, null, 2)),
    runId,
  });
  await saveArtifact(ctx, {
    kind: "report_md",
    label: "Report (Markdown)",
    data: Buffer.from(renderMarkdown(report)),
    runId,
  });
  await saveArtifact(ctx, {
    kind: "report_html",
    label: "Report (printable HTML)",
    data: Buffer.from(renderHtml(report)),
    runId,
  });
  await saveArtifact(ctx, {
    kind: "fix_packet",
    label: "Fix packet (Markdown)",
    data: Buffer.from(renderFixPacket(report)),
    runId,
  });
  await ctx.db
    .update(schema.runs)
    .set({ report: report as unknown as Record<string, unknown> })
    .where(eq(schema.runs.id, runId));
}
