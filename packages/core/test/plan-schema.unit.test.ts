import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { actionSchema, generatedPlanSchema, scenarioSchema } from "../src/schemas/plan";
import { enforcePlanLimits } from "../src/llm/provider";

const fixture = JSON.parse(
  readFileSync(path.resolve(__dirname, "../fixtures/plans/taskpad-demo.json"), "utf8"),
) as { plan: unknown };

const baseScenario = {
  key: "SC-001",
  title: "t",
  rationale: "r",
  priority: "P1",
  riskArea: "core_flow",
  personaKey: "P-A",
  journeyKey: "J-A",
  startRoute: "/",
  requiresAuth: false,
  dataMode: "read_only",
  prohibitedActionClass: "none",
  maxActions: 5,
  steps: [
    { action: "navigate", target: "/" },
    { action: "assertUrl", contains: "/" },
  ],
  expectedOutcomes: ["loads"],
};

describe("structured plan validation", () => {
  it("accepts the demo fixture plan", () => {
    const r = generatedPlanSchema.safeParse(fixture.plan);
    expect(r.success, JSON.stringify(r.error?.issues.slice(0, 3))).toBe(true);
    expect(r.data?.scenarios.length).toBeGreaterThanOrEqual(10);
    expect(r.data?.personas.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects unknown actions and arbitrary script payloads", () => {
    for (const bad of [
      { action: "evaluate", script: "document.cookie" },
      { action: "runScript", code: "alert(1)" },
      { action: "click", locator: { by: "role", role: "button", name: "x" }, script: "x()" },
      { action: "click", locator: { by: "js", value: "() => 1" } },
      { action: "click", locator: { by: "css", value: "js=document.body" } },
      { action: "click", locator: { by: "css", value: "a[href='javascript:alert(1)']" } },
      { action: "navigate", target: "javascript:alert(1)" },
      { action: "navigate", target: "file:///etc/passwd" },
      { action: "press", key: "Control+Shift+I" },
    ]) {
      expect(actionSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("only allows secret references by key, never inline credential objects", () => {
    const ok = actionSchema.safeParse({
      action: "fill",
      locator: { by: "label", value: "Password" },
      value: { secretRef: "password" },
    });
    expect(ok.success).toBe(true);
    for (const bad of [
      { secretRef: "apiKey" },
      { secretRef: "password", value: "x" },
      { password: "hunter2" },
    ]) {
      expect(
        actionSchema.safeParse({ action: "fill", locator: { by: "label", value: "P" }, value: bad })
          .success,
      ).toBe(false);
    }
  });

  it("requires at least one assertion and respects maxActions", () => {
    expect(scenarioSchema.safeParse(baseScenario).success).toBe(true);
    expect(
      scenarioSchema.safeParse({ ...baseScenario, steps: [{ action: "navigate", target: "/" }] })
        .success,
    ).toBe(false);
    expect(scenarioSchema.safeParse({ ...baseScenario, maxActions: 1 }).success).toBe(false);
    expect(scenarioSchema.safeParse({ ...baseScenario, extra: 1 }).success).toBe(false);
  });

  it("rejects plans with dangling persona/journey references and duplicate keys", () => {
    const plan = fixture.plan as { scenarios: { personaKey: string; key: string }[] };
    const dangling = structuredClone(plan);
    dangling.scenarios[0]!.personaKey = "P-NOPE";
    expect(generatedPlanSchema.safeParse(dangling).success).toBe(false);
    const dup = structuredClone(plan);
    dup.scenarios[1]!.key = dup.scenarios[0]!.key;
    expect(generatedPlanSchema.safeParse(dup).success).toBe(false);
  });

  it("enforces scenario limits by priority, deterministically", () => {
    const plan = generatedPlanSchema.parse(fixture.plan);
    const { plan: limited, notes } = enforcePlanLimits(plan, {
      maxPersonas: 5,
      maxScenarios: 3,
      maxActionsPerScenario: 40,
    });
    expect(limited.scenarios).toHaveLength(3);
    expect(limited.scenarios.every((s) => s.priority === "P0")).toBe(true);
    expect(notes[0]).toMatch(/Dropped/);
  });
});
