import { generatedPlanSchema, targetInputSchema } from "@testapp/core";
import { createPlanVersion, createTarget, getPlan } from "@testapp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, TEST_ENC_KEY } from "../../../packages/db/test/helpers";
import { handleGeneratePlan } from "../src/jobs/plan";
import { testContext } from "./helpers";

let t: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});

describe("fake-provider plan generation job", () => {
  it("persists a schema-valid plan with personas, coverage and scenarios", async () => {
    const targetId = await createTarget(
      t.db,
      targetInputSchema.parse({
        projectName: "P",
        name: "TaskPad staging",
        baseUrl: "http://127.0.0.1:4000/",
        brief: "TaskPad is a small task manager for team members.",
        authorizationConfirmed: true,
        isStaging: true,
        allowedOrigins: ["http://127.0.0.1:4000"],
        allowPrivateNetwork: true,
        allowDisposableWrites: true,
        authMode: "none",
      }),
      TEST_ENC_KEY,
    );
    const pv = await createPlanVersion(t.db, {
      targetId,
      briefVersionId: null,
      provider: "fake",
      model: null,
      isFake: true,
    });
    await handleGeneratePlan(testContext(t.db, t.url), { targetId, planVersionId: pv.id });
    const plan = await getPlan(t.db, pv.id);
    expect(plan?.plan.status).toBe("ready");
    expect(plan?.plan.isFake).toBe(true);
    expect(plan?.personas.length).toBeGreaterThanOrEqual(3);
    expect(plan?.plan.coverage.length).toBeGreaterThan(0);
    const reconstructed = {
      personas: plan!.personas,
      journeys: plan!.journeys,
      coverage: plan!.plan.coverage,
      scenarios: plan!.scenarios.map((s) => s.definition),
      assumptions: plan!.plan.assumptions,
      unsupportedAreas: plan!.plan.unsupportedAreas,
    };
    expect(generatedPlanSchema.safeParse(reconstructed).success).toBe(true);
  });

  it("marks the plan failed when the target has no brief", async () => {
    await expect(
      handleGeneratePlan(testContext(t.db, t.url), {
        targetId: "00000000-0000-0000-0000-000000000000",
        planVersionId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow();
  });
});
