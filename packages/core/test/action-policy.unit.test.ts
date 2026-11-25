import { describe, expect, it } from "vitest";
import {
  classifyText,
  evaluateAction,
  evaluateScenario,
  type ActionPolicyContext,
} from "../src/policy/actions";
import { scenarioSchema } from "../src/schemas/plan";

const ctx: ActionPolicyContext = {
  allowDisposableWrites: true,
  scenarioDataMode: "disposable_write",
  forbiddenSelectors: ["#danger-zone button"],
  forbiddenRoutes: ["/admin/billing"],
  baseUrl: "https://staging.example.test/",
};
const click = (name: string) => ({
  action: "click",
  locator: { by: "role", role: "button", name },
});

describe("prohibited-action policy", () => {
  it("blocks purchase, deletion and external-message semantics regardless of permissions", () => {
    for (const [name, code] of [
      ["Buy now", "purchase"],
      ["Proceed to checkout", "purchase"],
      ["Place order", "purchase"],
      ["Delete task", "deletion"],
      ["Remove member", "deletion"],
      ["Send invitation", "external_message"],
      ["Email this report", "external_message"],
      ["Share", "external_message"],
    ] as const) {
      const d = evaluateAction(click(name), ctx);
      expect(d.allowed, name).toBe(false);
      if (!d.allowed) expect(d.code).toBe(code);
    }
  });

  it("requires disposable-write permission for write-like clicks", () => {
    expect(evaluateAction(click("Save changes"), ctx)).toEqual({ allowed: true, isWrite: true });
    const ro = evaluateAction(click("Save changes"), { ...ctx, scenarioDataMode: "read_only" });
    expect(ro.allowed).toBe(false);
    const noWrites = evaluateAction(click("Add task"), { ...ctx, allowDisposableWrites: false });
    expect(noWrites.allowed).toBe(false);
    expect(
      evaluateAction(click("Next page"), { ...ctx, scenarioDataMode: "read_only" }).allowed,
    ).toBe(true);
  });

  it("enforces forbidden selectors and routes", () => {
    expect(
      evaluateAction({ action: "click", locator: { by: "css", value: "#danger-zone button" } }, ctx)
        .allowed,
    ).toBe(false);
    expect(
      evaluateAction({ action: "navigate", target: "/admin/billing/plans" }, ctx).allowed,
    ).toBe(false);
    expect(evaluateAction({ action: "navigate", target: "/checkout" }, ctx).allowed).toBe(false);
    expect(evaluateAction({ action: "navigate", target: "/tasks" }, ctx).allowed).toBe(true);
  });

  it("rejects schema-invalid actions before anything else", () => {
    const d = evaluateAction({ action: "eval", js: "1" }, ctx);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe("schema");
  });

  it("classifies text", () => {
    expect(classifyText("Unsubscribe")).toBe("neutral");
    expect(classifyText("Subscribe")).toBe("purchase");
    expect(classifyText("Open details")).toBe("neutral");
  });

  it("flags prohibited scenario classes and writes on read-only targets", () => {
    const s = scenarioSchema.parse({
      key: "SC-009",
      title: "t",
      rationale: "r",
      priority: "P1",
      riskArea: "core_flow",
      personaKey: "P-A",
      journeyKey: "J-A",
      startRoute: "/",
      requiresAuth: true,
      dataMode: "disposable_write",
      prohibitedActionClass: "purchase",
      maxActions: 5,
      steps: [click("Buy now"), { action: "assertUrl", contains: "/" }],
      expectedOutcomes: ["x"],
    });
    const issues = evaluateScenario(s, { ...ctx, allowDisposableWrites: false }, 40);
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("prohibited_class");
    expect(codes).toContain("write_not_permitted");
    expect(codes).toContain("purchase");
  });
});
