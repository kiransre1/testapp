import { type GeneratedPlan, type Scenario, scenarioSchema } from "@testapp/core";
import { and, asc, desc, eq, max } from "drizzle-orm";
import type { Db } from "../client";
import { journeys, personas, scenarios, testPlanVersions } from "../schema";

export type PlanVersionRow = typeof testPlanVersions.$inferSelect;
export type ScenarioRow = typeof scenarios.$inferSelect;

export async function createPlanVersion(
  db: Db,
  v: {
    targetId: string;
    briefVersionId: string | null;
    provider: string;
    model: string | null;
    isFake: boolean;
    parentPlanId?: string;
  },
): Promise<PlanVersionRow> {
  return db.transaction(async (tx) => {
    const [m] = await tx
      .select({ v: max(testPlanVersions.version) })
      .from(testPlanVersions)
      .where(eq(testPlanVersions.targetId, v.targetId));
    const [row] = await tx
      .insert(testPlanVersions)
      .values({ ...v, version: (m?.v ?? 0) + 1, status: "generating" })
      .returning();
    return row!;
  });
}

export async function savePlanContent(
  db: Db,
  planVersionId: string,
  plan: GeneratedPlan,
  meta: {
    notes?: string;
    tokenUsage?: { inputTokens: number; outputTokens: number };
    model?: string | null;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(personas).where(eq(personas.planVersionId, planVersionId));
    await tx.delete(journeys).where(eq(journeys.planVersionId, planVersionId));
    await tx.delete(scenarios).where(eq(scenarios.planVersionId, planVersionId));
    if (plan.personas.length) {
      await tx
        .insert(personas)
        .values(plan.personas.map((p) => ({ planVersionId, key: p.key, data: p })));
    }
    if (plan.journeys.length) {
      await tx
        .insert(journeys)
        .values(plan.journeys.map((j) => ({ planVersionId, key: j.key, data: j })));
    }
    await tx.insert(scenarios).values(
      plan.scenarios.map((s, i) => ({
        planVersionId,
        key: s.key,
        version: s.version,
        ordinal: i,
        enabled: !s.blockedReason,
        definition: s,
      })),
    );
    await tx
      .update(testPlanVersions)
      .set({
        status: "ready",
        coverage: plan.coverage,
        assumptions: plan.assumptions,
        unsupportedAreas: plan.unsupportedAreas,
        notes: meta.notes ?? "",
        tokenUsage: meta.tokenUsage,
        model: meta.model ?? undefined,
        error: null,
      })
      .where(eq(testPlanVersions.id, planVersionId));
  });
}

export async function failPlanVersion(db: Db, planVersionId: string, error: string): Promise<void> {
  await db
    .update(testPlanVersions)
    .set({ status: "failed", error: error.slice(0, 2000) })
    .where(eq(testPlanVersions.id, planVersionId));
}

export async function getPlan(db: Db, planVersionId: string) {
  const [plan] = await db
    .select()
    .from(testPlanVersions)
    .where(eq(testPlanVersions.id, planVersionId));
  if (!plan) return null;
  const [ps, js, ss] = await Promise.all([
    db
      .select()
      .from(personas)
      .where(eq(personas.planVersionId, planVersionId))
      .orderBy(asc(personas.key)),
    db
      .select()
      .from(journeys)
      .where(eq(journeys.planVersionId, planVersionId))
      .orderBy(asc(journeys.key)),
    db
      .select()
      .from(scenarios)
      .where(eq(scenarios.planVersionId, planVersionId))
      .orderBy(asc(scenarios.ordinal)),
  ]);
  return { plan, personas: ps.map((p) => p.data), journeys: js.map((j) => j.data), scenarios: ss };
}

export async function listPlans(db: Db, targetId: string) {
  return db
    .select()
    .from(testPlanVersions)
    .where(eq(testPlanVersions.targetId, targetId))
    .orderBy(desc(testPlanVersions.version));
}

export async function setScenarioEnabled(
  db: Db,
  planVersionId: string,
  key: string,
  enabled: boolean,
): Promise<boolean> {
  const rows = await db
    .update(scenarios)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(scenarios.planVersionId, planVersionId), eq(scenarios.key, key)))
    .returning({ id: scenarios.id });
  return rows.length === 1;
}

/**
 * Replace a scenario definition after strict validation. The key must not
 * change; the scenario version is bumped so regression comparison can tell an
 * edited scenario from the original.
 */
export async function updateScenarioDefinition(
  db: Db,
  planVersionId: string,
  key: string,
  raw: unknown,
): Promise<{ ok: true; scenario: Scenario } | { ok: false; errors: string[] }> {
  const parsed = scenarioSchema.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  if (parsed.data.key !== key)
    return { ok: false, errors: ["key: the scenario key cannot be changed"] };
  const [current] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.planVersionId, planVersionId), eq(scenarios.key, key)));
  if (!current) return { ok: false, errors: ["scenario not found"] };
  const next: Scenario = { ...parsed.data, version: current.version + 1 };
  await db
    .update(scenarios)
    .set({ definition: next, version: next.version, updatedAt: new Date() })
    .where(eq(scenarios.id, current.id));
  return { ok: true, scenario: next };
}
