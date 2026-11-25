import Anthropic from "@anthropic-ai/sdk";
import {
  ANALYST_SYSTEM_PROMPT,
  type AnalysisInput,
  type AnalysisOutput,
  analysisOutputSchema,
  buildAnalysisPrompt,
  buildPlanningPrompt,
  enforcePlanLimits,
  estimateTokens,
  type GeneratedPlan,
  generatedPlanSchema,
  type LlmProvider,
  PLANNER_SYSTEM_PROMPT,
  type PlanningInput,
  ProviderError,
  type ProviderResult,
  type TokenBudget,
  type TokenUsage,
} from "@testapp/core";
import { z } from "zod";

/**
 * Real provider using the official Anthropic SDK with schema-constrained JSON
 * output (`output_config.format`). Every response is re-validated with the
 * full Zod schema (including refinements the JSON schema cannot express).
 * Never falls back to fake output. Prompts and responses are never logged.
 *
 * The model is operator-configured (ANTHROPIC_MODEL); none is hardcoded.
 * No `thinking` parameter is sent so the request shape stays valid across the
 * models an operator might configure.
 */

const UNSUPPORTED_KEYWORDS = new Set([
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minItems",
  "maxItems",
  "format",
  "default",
  "$schema",
]);

/** Strip constraint keywords structured outputs may not accept; Zod enforces them afterwards. */
export function toOutputSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<
    string,
    unknown
  >;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (UNSUPPORTED_KEYWORDS.has(k)) continue;
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };
  return walk(json) as Record<string, unknown>;
}

export type AnthropicProviderOptions = {
  apiKey: string;
  model: string;
  /** Inject a client (tests). */
  client?: Pick<Anthropic, "messages">;
  maxOutputTokens?: number;
};

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly isFake = false;
  readonly model: string;
  private readonly client: Pick<Anthropic, "messages">;
  private readonly maxOutputTokens: number;

  constructor(opts: AnthropicProviderOptions) {
    if (!opts.apiKey && !opts.client)
      throw new ProviderError("ANTHROPIC_API_KEY is not configured", "config");
    if (!opts.model) throw new ProviderError("ANTHROPIC_MODEL is not configured", "config");
    this.model = opts.model;
    this.maxOutputTokens = opts.maxOutputTokens ?? 32_000;
    this.client =
      opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 10 * 60 * 1000 });
  }

  async generatePlan(
    input: PlanningInput,
    budget: TokenBudget,
  ): Promise<ProviderResult<GeneratedPlan>> {
    const result = await this.structured(
      PLANNER_SYSTEM_PROMPT,
      buildPlanningPrompt(input),
      generatedPlanSchema,
      budget,
    );
    const { plan } = enforcePlanLimits(result.data, input.limits);
    return { ...result, data: plan };
  }

  async analyseRun(
    input: AnalysisInput,
    budget: TokenBudget,
  ): Promise<ProviderResult<AnalysisOutput>> {
    return this.structured(
      ANALYST_SYSTEM_PROMPT,
      buildAnalysisPrompt(input),
      analysisOutputSchema,
      budget,
    );
  }

  private async structured<T extends z.ZodType>(
    system: string,
    prompt: string,
    schema: T,
    budget: TokenBudget,
  ): Promise<ProviderResult<z.infer<T>>> {
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    const outputSchema = toOutputSchema(schema);
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

    for (let attempt = 0; attempt < 2; attempt++) {
      const estimatedInput =
        estimateTokens(system) +
        messages.reduce((n, m) => n + estimateTokens(JSON.stringify(m.content)), 0) +
        estimateTokens(JSON.stringify(outputSchema));
      const remainingIn = budget.remainingInputTokens - usage.inputTokens;
      const remainingOut = budget.remainingOutputTokens - usage.outputTokens;
      if (estimatedInput > remainingIn) {
        throw new ProviderError(
          `input-token budget would be exceeded (need ~${estimatedInput}, ${remainingIn} left)`,
          "budget",
        );
      }
      const maxTokens = Math.min(this.maxOutputTokens, remainingOut);
      if (maxTokens < 1024) throw new ProviderError("output-token budget exhausted", "budget");

      let message: Anthropic.Message;
      try {
        message = await this.client.messages
          .stream({
            model: this.model,
            max_tokens: maxTokens,
            system,
            messages,
            output_config: { format: { type: "json_schema", schema: outputSchema } },
          })
          .finalMessage();
      } catch (err) {
        throw mapSdkError(err);
      }
      usage.inputTokens += message.usage.input_tokens;
      usage.outputTokens += message.usage.output_tokens;

      if (message.stop_reason === "refusal")
        throw new ProviderError("the model declined the request", "refusal");
      if (message.stop_reason === "max_tokens")
        throw new ProviderError("response truncated at the output-token limit", "malformed");
      const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        raw = undefined;
      }
      const parsed = raw === undefined ? null : schema.safeParse(raw);
      if (parsed?.success) return { data: parsed.data, usage, model: this.model };

      const problems = parsed
        ? parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`)
        : ["response was not valid JSON"];
      if (attempt === 1) {
        throw new ProviderError(
          `model output failed schema validation: ${problems.slice(0, 5).join("; ")}`,
          "malformed",
        );
      }
      // One bounded repair attempt with the validator's feedback.
      messages.push({ role: "assistant", content: text.slice(0, 200_000) || "{}" });
      messages.push({
        role: "user",
        content: `Your JSON failed validation:\n${problems.join("\n")}\nReturn the complete corrected JSON only.`,
      });
    }
    throw new ProviderError("unreachable", "malformed");
  }
}

export function mapSdkError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.RateLimitError)
    return new ProviderError("Anthropic rate limit reached; retry later", "rate_limit");
  if (err instanceof Anthropic.AuthenticationError)
    return new ProviderError("Anthropic authentication failed; check ANTHROPIC_API_KEY", "config");
  if (err instanceof Anthropic.NotFoundError)
    return new ProviderError(
      "Anthropic model not found; check ANTHROPIC_MODEL is available to your account",
      "config",
    );
  if (err instanceof Anthropic.BadRequestError)
    return new ProviderError(
      `Anthropic rejected the request (400): ${err.message.slice(0, 300)}`,
      "api",
    );
  if (err instanceof Anthropic.APIConnectionError)
    return new ProviderError("could not reach the Anthropic API", "api");
  if (err instanceof Anthropic.APIError)
    return new ProviderError(`Anthropic API error ${err.status ?? ""}`.trim(), "api");
  return new ProviderError(err instanceof Error ? err.message : "unknown provider error", "api");
}
