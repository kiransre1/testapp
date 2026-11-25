import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import {
  analysisOutputSchema,
  generatedPlanSchema,
  type PlanningInput,
  ProviderError,
} from "@testapp/core";
import { AnthropicProvider, toOutputSchema } from "../src/llm/anthropic";
import { FakeProvider } from "../src/llm/fake";

const fixtureDir = path.resolve(__dirname, "../../../packages/core/fixtures");
const input = (brief: string): PlanningInput => ({
  brief,
  target: {
    name: "T",
    baseUrl: "https://s.example.test/",
    startPath: "/",
    authMode: "form",
    allowDisposableWrites: true,
    prohibitedActionsSummary: "",
    roleNotes: null,
    buildLabel: null,
  },
  discovery: {
    pages: [
      {
        path: "/about",
        title: "About",
        headings: ["About us"],
        links: [],
        forms: [],
        buttons: [],
        landmarks: ["main"],
      },
    ],
    truncated: false,
  },
  limits: { maxPersonas: 5, maxScenarios: 20, maxActionsPerScenario: 40 },
});
const budget = { remainingInputTokens: 100_000, remainingOutputTokens: 40_000 };

describe("FakeProvider", () => {
  it("is deterministic and returns the matching fixture", async () => {
    const p = new FakeProvider(fixtureDir);
    const a = await p.generatePlan(input("TaskPad is a task app"));
    const b = await p.generatePlan(input("TaskPad is a task app"));
    expect(a).toEqual(b);
    expect(a.data.scenarios.map((s) => s.key)).toContain("SC-005");
    expect(a.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(p.isFake).toBe(true);
  });

  it("derives a schema-valid generic plan from discovery when no fixture matches", async () => {
    const r = await new FakeProvider(fixtureDir).generatePlan(
      input("Some other product brief text"),
    );
    expect(generatedPlanSchema.safeParse(r.data).success).toBe(true);
    expect(r.data.scenarios.some((s) => s.startRoute === "/about")).toBe(true);
  });

  it("produces schema-valid analysis that never claims observed defects", async () => {
    const r = await new FakeProvider(fixtureDir).analyseRun({
      brief: "tasks",
      targetName: "T",
      runtimeSymptoms: [],
      coverageGaps: ["Due dates"],
      scenarios: [
        {
          key: "SC-005",
          title: "Edit",
          riskArea: "persistence",
          journeyKey: "J-EDIT",
          status: "failed",
          reason: null,
        },
      ],
      observedFindings: [],
      accessibilityRules: [
        { id: "label", impact: "critical", help: "Form elements must have labels", count: 1 },
      ],
    });
    expect(analysisOutputSchema.safeParse(r.data).success).toBe(true);
    expect(JSON.stringify(r.data)).not.toMatch(/observed_failure/);
    expect(r.data.inferredRisks.length).toBeGreaterThan(0);
  });
});

function fakeClient(responses: Array<Partial<{ text: string; stop: string; error: Error }>>) {
  let i = 0;
  const calls: unknown[] = [];
  return {
    calls,
    messages: {
      stream: vi.fn((params: unknown) => {
        calls.push(params);
        const r = responses[i++] ?? responses[responses.length - 1]!;
        return {
          finalMessage: async () => {
            if (r.error) throw r.error;
            return {
              stop_reason: r.stop ?? "end_turn",
              content: [{ type: "text", text: r.text ?? "" }],
              usage: { input_tokens: 100, output_tokens: 50 },
            };
          },
        };
      }),
    },
  };
}

describe("AnthropicProvider (mocked client, no network)", () => {
  const validPlan = JSON.stringify(
    (new FakeProvider(fixtureDir) as unknown as { fixtures: { plan: unknown }[] }).fixtures[0]!
      .plan,
  );

  it("returns validated data and records usage", async () => {
    const client = fakeClient([{ text: validPlan }]);
    const p = new AnthropicProvider({
      apiKey: "",
      model: "operator-model",
      client: client as never,
    });
    const r = await p.generatePlan(input("TaskPad"), budget);
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    expect(r.data.scenarios.length).toBeGreaterThan(0);
    const params = client.calls[0] as {
      model: string;
      output_config: { format: { type: string } };
      messages: { content: string }[];
    };
    expect(params.model).toBe("operator-model");
    expect(params.output_config.format.type).toBe("json_schema");
  });

  it("repairs once after malformed output, then fails without falling back", async () => {
    const ok = fakeClient([{ text: "not json" }, { text: validPlan }]);
    const r = await new AnthropicProvider({
      apiKey: "",
      model: "m",
      client: ok as never,
    }).generatePlan(input("x"), budget);
    expect(r.usage.inputTokens).toBe(200);

    const bad = fakeClient([{ text: "{}" }, { text: '{"personas":[]}' }]);
    const p = new AnthropicProvider({ apiKey: "", model: "m", client: bad as never });
    await expect(p.generatePlan(input("x"), budget)).rejects.toMatchObject({ kind: "malformed" });
    expect(bad.calls).toHaveLength(2);
  });

  it("maps refusals and truncation to provider errors", async () => {
    const refused = new AnthropicProvider({
      apiKey: "",
      model: "m",
      client: fakeClient([{ stop: "refusal" }]) as never,
    });
    await expect(refused.generatePlan(input("x"), budget)).rejects.toMatchObject({
      kind: "refusal",
    });
    const truncated = new AnthropicProvider({
      apiKey: "",
      model: "m",
      client: fakeClient([{ stop: "max_tokens", text: "{" }]) as never,
    });
    await expect(truncated.generatePlan(input("x"), budget)).rejects.toMatchObject({
      kind: "malformed",
    });
  });

  it("refuses calls that cannot fit the token budget without calling the API", async () => {
    const client = fakeClient([{ text: validPlan }]);
    const p = new AnthropicProvider({ apiKey: "", model: "m", client: client as never });
    await expect(
      p.generatePlan(input("x"), { remainingInputTokens: 10, remainingOutputTokens: 40_000 }),
    ).rejects.toBeInstanceOf(ProviderError);
    await expect(
      p.generatePlan(input("x"), { remainingInputTokens: 100_000, remainingOutputTokens: 100 }),
    ).rejects.toMatchObject({ kind: "budget" });
    expect(client.calls).toHaveLength(0);
  });

  it("never includes secrets in the prompt because planning input has no secret fields", async () => {
    const client = fakeClient([{ text: validPlan }]);
    await new AnthropicProvider({ apiKey: "", model: "m", client: client as never }).generatePlan(
      input("brief"),
      budget,
    );
    const sent = JSON.stringify(client.calls[0]);
    expect(sent).toContain("untrusted_brief");
    expect(sent).not.toMatch(/"password"\s*:/);
  });

  it("builds a JSON schema without unsupported constraint keywords", () => {
    const s = JSON.stringify(toOutputSchema(generatedPlanSchema));
    expect(s).not.toMatch(/"(minLength|maxLength|pattern|maxItems)"/);
    expect(s).toContain("additionalProperties");
  });

  it("requires model configuration", () => {
    expect(() => new AnthropicProvider({ apiKey: "k", model: "" })).toThrow(/ANTHROPIC_MODEL/);
  });
});
