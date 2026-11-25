import type { Action, Locator, Scenario } from "../schemas/plan";
import { actionSchema } from "../schemas/plan";
import { isForbiddenRoute } from "./origin";

/**
 * Deterministic action policy. Applied when a plan is saved, again before each
 * step executes, and a third time against the resolved element's live
 * accessible name/text. Keyword heuristics are supplementary: target owners
 * must still disable or mock real integrations in staging.
 */

export type ActionPolicyContext = {
  allowDisposableWrites: boolean;
  scenarioDataMode: "read_only" | "disposable_write";
  forbiddenSelectors: readonly string[];
  forbiddenRoutes: readonly string[];
  baseUrl: string;
};

export type PolicyDecision =
  | { allowed: true; isWrite: boolean }
  | { allowed: false; code: PolicyBlockCode; reason: string };

export type PolicyBlockCode =
  | "schema"
  | "purchase"
  | "deletion"
  | "external_message"
  | "write_not_permitted"
  | "forbidden_selector"
  | "forbidden_route";

const PURCHASE =
  /\b(buy|purchase|check ?out|pay|payment|place (an )?order|subscribe|upgrade( plan)?|add to (cart|basket)|donate|billing)\b/i;
const DELETION =
  /\b(delete|remove|destroy|erase|purge|wipe|drop|deactivate|close account|clear all)\b/i;
const EXTERNAL =
  /\b(send|e-?mail|invite|share|notify|publish|post to|tweet|sms|text message|broadcast|webhook)\b/i;
const WRITE = /\b(save|create|add|submit|update|edit|confirm|apply|new|rename|upload)\b/i;

export function classifyText(
  text: string,
): "purchase" | "deletion" | "external_message" | "write" | "neutral" {
  if (PURCHASE.test(text)) return "purchase";
  if (DELETION.test(text)) return "deletion";
  if (EXTERNAL.test(text)) return "external_message";
  if (WRITE.test(text)) return "write";
  return "neutral";
}

export function locatorText(l: Locator): string {
  switch (l.by) {
    case "role":
      return l.name ?? "";
    default:
      return l.value;
  }
}

function blockedFor(
  kind: "purchase" | "deletion" | "external_message",
  text: string,
): PolicyDecision {
  const what = {
    purchase: "purchase/payment",
    deletion: "deletion",
    external_message: "external message/notification",
  }[kind];
  return {
    allowed: false,
    code: kind,
    reason: `"${text.slice(0, 80)}" looks like a ${what} action, which is prohibited`,
  };
}

/** Evaluate a click-like interaction against text describing the element. */
export function evaluateInteractionText(text: string, ctx: ActionPolicyContext): PolicyDecision {
  const cls = classifyText(text);
  if (cls === "purchase" || cls === "deletion" || cls === "external_message")
    return blockedFor(cls, text);
  if (cls === "write") {
    if (ctx.scenarioDataMode !== "disposable_write") {
      return {
        allowed: false,
        code: "write_not_permitted",
        reason: `"${text.slice(0, 80)}" is a write action in a read-only scenario`,
      };
    }
    if (!ctx.allowDisposableWrites) {
      return {
        allowed: false,
        code: "write_not_permitted",
        reason: "disposable writes are not enabled for this target",
      };
    }
    return { allowed: true, isWrite: true };
  }
  return { allowed: true, isWrite: false };
}

/** Static evaluation of a planned action (before execution). */
export function evaluateAction(raw: unknown, ctx: ActionPolicyContext): PolicyDecision {
  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      allowed: false,
      code: "schema",
      reason: `action rejected by schema: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    };
  }
  const action: Action = parsed.data;
  const loc = "locator" in action ? action.locator : undefined;
  if (loc && loc.by === "css") {
    const css = loc.value.trim();
    if (ctx.forbiddenSelectors.some((s) => s.trim() === css)) {
      return {
        allowed: false,
        code: "forbidden_selector",
        reason: `selector ${css} is forbidden for this target`,
      };
    }
  }
  switch (action.action) {
    case "navigate": {
      let url: URL;
      try {
        url = new URL(action.target, ctx.baseUrl);
      } catch {
        return { allowed: false, code: "schema", reason: "invalid navigation target" };
      }
      if (isForbiddenRoute(url, ctx.forbiddenRoutes)) {
        return {
          allowed: false,
          code: "forbidden_route",
          reason: `route ${url.pathname} is forbidden for this target`,
        };
      }
      const cls = classifyText(url.pathname.replace(/[/_-]+/g, " "));
      if (cls === "purchase" || cls === "deletion") return blockedFor(cls, url.pathname);
      return { allowed: true, isWrite: false };
    }
    case "click":
    case "check":
    case "select":
      return evaluateInteractionText(locatorText(action.locator), ctx);
    case "press":
      return action.key === "Enter" && action.locator
        ? evaluateInteractionText(locatorText(action.locator), { ...ctx })
        : { allowed: true, isWrite: false };
    default:
      return { allowed: true, isWrite: false };
  }
}

export type ScenarioPolicyIssue = {
  stepIndex: number | null;
  code: PolicyBlockCode | "prohibited_class" | "budget";
  reason: string;
};

/** Validate a whole scenario; any issue means it must not execute (it is reported as blocked). */
export function evaluateScenario(
  s: Scenario,
  ctx: Omit<ActionPolicyContext, "scenarioDataMode">,
  maxActionsPerScenario: number,
): ScenarioPolicyIssue[] {
  const issues: ScenarioPolicyIssue[] = [];
  if (s.prohibitedActionClass !== "none") {
    issues.push({
      stepIndex: null,
      code: "prohibited_class",
      reason: `scenario is classified as ${s.prohibitedActionClass}, which is prohibited`,
    });
  }
  if (s.dataMode === "disposable_write" && !ctx.allowDisposableWrites) {
    issues.push({
      stepIndex: null,
      code: "write_not_permitted",
      reason: "scenario creates/edits data but disposable writes are not enabled for this target",
    });
  }
  if (s.steps.length > maxActionsPerScenario) {
    issues.push({
      stepIndex: null,
      code: "budget",
      reason: `scenario has ${s.steps.length} steps, above the per-scenario action budget of ${maxActionsPerScenario}`,
    });
  }
  s.steps.forEach((step, i) => {
    const d = evaluateAction(step, { ...ctx, scenarioDataMode: s.dataMode });
    if (!d.allowed) issues.push({ stepIndex: i, code: d.code, reason: d.reason });
  });
  return issues;
}
