import { type LlmProvider, ProviderError, type ServerEnv } from "@testapp/core";
import { AnthropicProvider } from "./anthropic";
import { FakeProvider, resolveFixtureDir } from "./fake";

/** Build the configured provider. There is no silent fallback between providers. */
export function createProvider(env: ServerEnv): LlmProvider {
  if (env.LLM_PROVIDER === "fake")
    return new FakeProvider(resolveFixtureDir(env.FAKE_PROVIDER_FIXTURE_DIR));
  if (!env.ANTHROPIC_API_KEY || !env.ANTHROPIC_MODEL) {
    throw new ProviderError(
      "LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY and ANTHROPIC_MODEL",
      "config",
    );
  }
  return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL });
}

/** Estimated cost in USD, only when pricing is configured. */
export function estimateCostUsd(
  env: ServerEnv,
  inputTokens: number,
  outputTokens: number,
): number | null {
  if (env.LLM_PROVIDER !== "anthropic") return 0;
  const pin = env.ANTHROPIC_INPUT_PRICE_PER_MTOK;
  const pout = env.ANTHROPIC_OUTPUT_PRICE_PER_MTOK;
  if (pin === undefined || pout === undefined) return null;
  return (inputTokens * pin + outputTokens * pout) / 1_000_000;
}
