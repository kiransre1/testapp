import { z } from "zod";

/**
 * Environment configuration shared by web, worker and CLIs.
 * Values are validated once at process start. Secret values are never logged;
 * use describeConfig() for a redacted summary.
 */

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase()),
  );

const positiveNumber = (def: number) => z.coerce.number().positive().default(def);
const positiveInt = (def: number) => z.coerce.number().int().positive().default(def);

export const budgetDefaultsSchema = z.object({
  DEFAULT_MAX_ELAPSED_MINUTES: positiveNumber(20),
  DEFAULT_MAX_SCENARIOS: positiveInt(20),
  DEFAULT_MAX_ACTIONS_PER_SCENARIO: positiveInt(40),
  DEFAULT_MAX_TOTAL_ACTIONS: positiveInt(400),
  DEFAULT_MAX_INPUT_TOKENS: positiveInt(200_000),
  DEFAULT_MAX_OUTPUT_TOKENS: positiveInt(40_000),
  DEFAULT_MAX_ESTIMATED_COST_USD: positiveNumber(2),
  DEFAULT_MAX_REPEATED_ACTIONS: positiveInt(5),
  DEFAULT_MAX_CONSECUTIVE_BLOCKED: positiveInt(3),
});

const base64Key32 = z
  .string()
  .min(1)
  .refine((v) => {
    try {
      return Buffer.from(v, "base64").length === 32;
    } catch {
      return false;
    }
  }, "must be 32 bytes encoded as base64 (generate with: openssl rand -base64 32)");

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DATABASE_URL: z.string().url(),
    APP_BASE_URL: z.string().url().default("http://127.0.0.1:3000"),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
    APP_ENCRYPTION_KEY: base64Key32,
    DATA_DIR: z.string().min(1).default("./.data"),
    LLM_PROVIDER: z.enum(["fake", "anthropic"]).default("fake"),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().optional(),
    ANTHROPIC_INPUT_PRICE_PER_MTOK: z.coerce.number().nonnegative().optional(),
    ANTHROPIC_OUTPUT_PRICE_PER_MTOK: z.coerce.number().nonnegative().optional(),
    FAKE_PROVIDER_FIXTURE_DIR: z.string().optional(),
    DEMO_MODE: boolish.default(false),
    DEMO_TARGET_HOSTNAMES: z.string().default("demo-target,localhost,127.0.0.1"),
    COOKIE_SECURE: boolish.default(false),
    WORKER_POLL_INTERVAL_MS: positiveInt(1000),
    WORKER_LEASE_SECONDS: positiveInt(60),
    WORKER_ID: z.string().optional(),
  })
  .merge(budgetDefaultsSchema)
  .superRefine((env, ctx) => {
    if (env.LLM_PROVIDER === "anthropic") {
      if (!env.ANTHROPIC_API_KEY) {
        ctx.addIssue({
          code: "custom",
          path: ["ANTHROPIC_API_KEY"],
          message: "required when LLM_PROVIDER=anthropic",
        });
      }
      if (!env.ANTHROPIC_MODEL) {
        ctx.addIssue({
          code: "custom",
          path: ["ANTHROPIC_MODEL"],
          message:
            "required when LLM_PROVIDER=anthropic; supply a model your Anthropic account supports",
        });
      }
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

/** Parse and validate environment. Error messages name variables, never values. */
export function loadServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v !== undefined && v !== "") cleaned[k] = v;
  }
  const parsed = serverEnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  return parsed.data;
}

const SECRET_KEYS = new Set([
  "DATABASE_URL",
  "SESSION_SECRET",
  "APP_ENCRYPTION_KEY",
  "ANTHROPIC_API_KEY",
  "BOOTSTRAP_ADMIN_PASSWORD",
]);

/** Redacted summary suitable for logs. */
export function describeConfig(env: ServerEnv): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = SECRET_KEYS.has(k) ? (v ? "[set]" : "[unset]") : v;
  }
  return out;
}
