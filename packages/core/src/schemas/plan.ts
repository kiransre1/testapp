import { z } from "zod";

/**
 * Structured test-plan contracts. Everything a provider (LLM or fake) returns
 * is validated against these schemas. Objects are strict: unknown keys are
 * rejected, which is how arbitrary script / unknown action payloads are kept
 * out of the runner.
 */

const shortText = z.string().trim().min(1).max(300);
const longText = z.string().trim().min(1).max(2000);

export const ARIA_ROLES = [
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "heading",
  "list",
  "listitem",
  "navigation",
  "main",
  "banner",
  "dialog",
  "alert",
  "status",
  "tab",
  "tabpanel",
  "table",
  "row",
  "cell",
  "form",
  "img",
  "menu",
  "menuitem",
  "region",
  "article",
  "switch",
  "spinbutton",
] as const;

const nth = z.number().int().min(0).max(50).optional();
const exact = z.boolean().optional();

/** CSS fallback is constrained: no javascript:, no Playwright engine prefixes. */
const cssSelector = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((s) => !/javascript:|>>|^\s*(xpath|js|internal|_react|_vue)\s*=/i.test(s), {
    message: "CSS locator may not use script or engine-prefixed selectors",
  });

export const locatorSchema = z.discriminatedUnion("by", [
  z
    .object({
      by: z.literal("role"),
      role: z.enum(ARIA_ROLES),
      name: shortText.optional(),
      exact,
      nth,
    })
    .strict(),
  z.object({ by: z.literal("label"), value: shortText, exact, nth }).strict(),
  z.object({ by: z.literal("text"), value: shortText, exact, nth }).strict(),
  z.object({ by: z.literal("placeholder"), value: shortText, exact, nth }).strict(),
  z.object({ by: z.literal("testId"), value: shortText, nth }).strict(),
  z.object({ by: z.literal("css"), value: cssSelector, nth }).strict(),
]);
export type Locator = z.infer<typeof locatorSchema>;

export const SECRET_KEYS = ["username", "password"] as const;
export const secretRefSchema = z.object({ secretRef: z.enum(SECRET_KEYS) }).strict();
export type SecretRef = z.infer<typeof secretRefSchema>;

/** Literal text (may contain the {{run}} token, replaced by the run prefix) or a secret reference. */
export const fillValueSchema = z.union([z.string().max(2000), secretRefSchema]);

export const ALLOWED_KEYS = [
  "Enter",
  "Tab",
  "Shift+Tab",
  "Escape",
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "Backspace",
  "Home",
  "End",
] as const;

/** Relative path ("/tasks") or absolute http(s) URL. Origin is enforced at runtime. */
const navTarget = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine((s) => s.startsWith("/") || /^https?:\/\//i.test(s), {
    message: "navigate target must be a relative path or http(s) URL",
  });

const description = z.string().max(300).optional();

export const ACTION_TYPES = [
  "navigate",
  "click",
  "fill",
  "select",
  "check",
  "press",
  "waitFor",
  "reload",
  "assertVisible",
  "assertText",
  "assertUrl",
  "assertCount",
  "runAccessibilityCheck",
  "screenshot",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("navigate"), target: navTarget, description }).strict(),
  z.object({ action: z.literal("click"), locator: locatorSchema, description }).strict(),
  z
    .object({
      action: z.literal("fill"),
      locator: locatorSchema,
      value: fillValueSchema,
      description,
    })
    .strict(),
  z
    .object({ action: z.literal("select"), locator: locatorSchema, option: shortText, description })
    .strict(),
  z
    .object({
      action: z.literal("check"),
      locator: locatorSchema,
      checked: z.boolean().default(true),
      description,
    })
    .strict(),
  z
    .object({
      action: z.literal("press"),
      key: z.enum(ALLOWED_KEYS),
      locator: locatorSchema.optional(),
      description,
    })
    .strict(),
  z
    .object({
      action: z.literal("waitFor"),
      locator: locatorSchema.optional(),
      urlContains: z.string().max(300).optional(),
      state: z.enum(["visible", "hidden"]).default("visible"),
      timeoutMs: z.number().int().min(100).max(15_000).default(5_000),
      description,
    })
    .strict()
    .refine((a) => a.locator || a.urlContains, {
      message: "waitFor needs a locator or urlContains",
    }),
  z.object({ action: z.literal("reload"), description }).strict(),
  z
    .object({
      action: z.literal("assertVisible"),
      locator: locatorSchema,
      visible: z.boolean().default(true),
      description,
    })
    .strict(),
  z
    .object({
      action: z.literal("assertText"),
      locator: locatorSchema,
      text: z.string().min(1).max(500),
      match: z.enum(["contains", "equals"]).default("contains"),
      description,
    })
    .strict(),
  z
    .object({
      action: z.literal("assertUrl"),
      contains: z.string().max(300).optional(),
      pathEquals: z.string().max(300).optional(),
      description,
    })
    .strict()
    .refine((a) => a.contains || a.pathEquals, {
      message: "assertUrl needs contains or pathEquals",
    }),
  z
    .object({
      action: z.literal("assertCount"),
      locator: locatorSchema,
      count: z.number().int().min(0).max(10_000),
      comparison: z.enum(["eq", "gte", "lte"]).default("eq"),
      description,
    })
    .strict(),
  z
    .object({
      action: z.literal("runAccessibilityCheck"),
      include: cssSelector.optional(),
      label: z.string().max(100).optional(),
      description,
    })
    .strict(),
  z
    .object({ action: z.literal("screenshot"), label: z.string().min(1).max(100), description })
    .strict(),
]);
export type Action = z.infer<typeof actionSchema>;
export type ActionInput = z.input<typeof actionSchema>;

export const ASSERTION_ACTIONS: ReadonlySet<string> = new Set([
  "assertVisible",
  "assertText",
  "assertUrl",
  "assertCount",
]);

export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export const RISK_AREAS = [
  "core_flow",
  "first_run",
  "empty_state",
  "validation",
  "persistence",
  "interruption",
  "permissions",
  "navigation",
  "error_handling",
  "loading_state",
  "responsive",
  "accessibility",
  "integration",
  "security_passive",
] as const;

export const PROHIBITED_CLASSES = [
  "none",
  "purchase",
  "deletion",
  "external_message",
  "external_side_effect",
] as const;

export const scenarioSchema = z
  .object({
    key: z.string().regex(/^[A-Z][A-Z0-9]{1,5}-\d{3}$/, "scenario key like SC-001"),
    version: z.number().int().min(1).default(1),
    title: shortText,
    rationale: longText,
    priority: z.enum(PRIORITIES),
    riskArea: z.enum(RISK_AREAS),
    personaKey: z.string().min(1).max(40),
    journeyKey: z.string().min(1).max(40),
    preconditions: z.array(shortText).max(10).default([]),
    startRoute: z.string().startsWith("/").max(500),
    requiresAuth: z.boolean(),
    dataMode: z.enum(["read_only", "disposable_write"]),
    prohibitedActionClass: z.enum(PROHIBITED_CLASSES),
    maxActions: z.number().int().min(1).max(100),
    steps: z.array(actionSchema).min(1).max(100),
    expectedOutcomes: z.array(shortText).min(1).max(10),
    /** Set when the brief does not support the scenario (e.g. unknown business rule). */
    blockedReason: z.string().max(500).optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.steps.length > s.maxActions) {
      ctx.addIssue({ code: "custom", path: ["steps"], message: "more steps than maxActions" });
    }
    if (
      !s.steps.some(
        (st) => ASSERTION_ACTIONS.has(st.action) || st.action === "runAccessibilityCheck",
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["steps"],
        message: "scenario needs at least one assertion or automated check",
      });
    }
  });
export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioInput = z.input<typeof scenarioSchema>;

export const personaSchema = z
  .object({
    key: z.string().regex(/^P-[A-Z0-9-]{1,30}$/, "persona key like P-ADMIN"),
    name: shortText,
    role: shortText,
    permissions: z.array(shortText).max(20),
    goal: shortText,
    successCriterion: shortText,
    productFamiliarity: z.enum(["none", "low", "medium", "high"]),
    technicalConfidence: z.enum(["low", "medium", "high"]),
    deviceProfile: z.enum(["desktop", "mobile"]),
    accessibilityNeeds: z.array(shortText).max(10).default([]),
    startingDataState: shortText,
    behaviours: z.array(shortText).max(10),
    mayNotPerform: z.array(shortText).max(20),
  })
  .strict();
export type Persona = z.infer<typeof personaSchema>;

export const journeySchema = z
  .object({
    key: z.string().regex(/^J-[A-Z0-9-]{1,30}$/, "journey key like J-CREATE"),
    title: shortText,
    personaKeys: z.array(z.string()).min(1).max(10),
    summary: longText,
    priority: z.enum(PRIORITIES),
  })
  .strict();
export type Journey = z.infer<typeof journeySchema>;

export const coverageRowSchema = z
  .object({
    area: shortText,
    journeyKey: z.string().optional(),
    scenarioKeys: z.array(z.string()).max(50),
    status: z.enum(["covered", "partial", "not_covered", "unsupported"]),
    notes: z.string().max(1000).default(""),
  })
  .strict();
export type CoverageRow = z.infer<typeof coverageRowSchema>;

export const generatedPlanSchema = z
  .object({
    personas: z.array(personaSchema).min(1).max(8),
    journeys: z.array(journeySchema).min(1).max(20),
    coverage: z.array(coverageRowSchema).max(60),
    scenarios: z.array(scenarioSchema).min(1).max(40),
    assumptions: z.array(longText).max(30).default([]),
    unsupportedAreas: z
      .array(z.object({ area: shortText, reason: longText }).strict())
      .max(30)
      .default([]),
  })
  .strict()
  .superRefine((p, ctx) => {
    const personaKeys = new Set(p.personas.map((x) => x.key));
    const journeyKeys = new Set(p.journeys.map((x) => x.key));
    const scenarioKeys = new Set<string>();
    p.scenarios.forEach((s, i) => {
      if (scenarioKeys.has(s.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["scenarios", i, "key"],
          message: `duplicate scenario key ${s.key}`,
        });
      }
      scenarioKeys.add(s.key);
      if (!personaKeys.has(s.personaKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["scenarios", i, "personaKey"],
          message: "unknown persona",
        });
      }
      if (!journeyKeys.has(s.journeyKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["scenarios", i, "journeyKey"],
          message: "unknown journey",
        });
      }
    });
  });
export type GeneratedPlan = z.infer<typeof generatedPlanSchema>;
export type GeneratedPlanInput = z.input<typeof generatedPlanSchema>;

/** Format zod issues compactly for UI/API error output. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 50).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}
