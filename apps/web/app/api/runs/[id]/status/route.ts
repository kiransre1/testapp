import { getRun, schema } from "@testapp/db";
import { eq, sql } from "drizzle-orm";
import { api, HttpError, json, requireUuid } from "@/lib/server/api";
import { getDb } from "@/lib/server/context";

/** Lightweight polling endpoint for live status. */
export const GET = api<{ id: string }>(async ({ params }) => {
  const db = getDb();
  const run = await getRun(db, requireUuid(params.id));
  if (!run) throw new HttpError(404, "not found");
  const counts = await db
    .select({ status: schema.scenarioResults.status, n: sql<number>`count(*)::int` })
    .from(schema.scenarioResults)
    .where(eq(schema.scenarioResults.runId, run.id))
    .groupBy(schema.scenarioResults.status);
  return json({
    id: run.id,
    status: run.status,
    statusReason: run.statusReason,
    cancelRequested: run.cancelRequested,
    budgetExhausted: run.budgetExhausted,
    usage: run.budgetUsage,
    scenarioCounts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
  });
});
