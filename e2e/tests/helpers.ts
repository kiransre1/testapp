import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
export const DEMO_URL = process.env.DEMO_TARGET_URL ?? "http://127.0.0.1:4000";
export const DEMO_USERNAME = process.env.E2E_DEMO_USERNAME ?? "demo.user@example.test";
export const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "";
export const TARGET_NAME = "TaskPad demo (staging)";

export const DEMO_BRIEF = `# TaskPad — application testing brief

TaskPad is a small task manager for team members.

## Users and roles
- Member: signs in with email and password, sees their own task list, creates tasks and edits task titles.

## Key journeys
1. Sign in and see "Your tasks".
2. Add a task: a title is required; the due date is optional. A confirmation is shown and the task appears in the list.
3. Edit a task title from the list; the new title must be saved and shown in the list, including after a reload.
4. Reports shows statistics including the total number of tasks.
5. Help explains the basics.

## Out of scope / prohibited
No deletion, no emails, no payments. Use only run-prefixed synthetic tasks.`;

export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

/** CSRF token from the authenticated page. */
export async function csrf(page: Page): Promise<string> {
  return (await page.locator('meta[name="csrf-token"]').getAttribute("content")) ?? "";
}

export async function apiPost(page: Page, url: string, body: unknown, method = "POST") {
  const token = await csrf(page);
  return page.request.fetch(url, {
    method,
    data: body,
    headers: {
      "content-type": "application/json",
      "x-csrf-token": token,
      origin: new URL(page.url()).origin,
    },
  });
}

export async function findTargetId(
  request: APIRequestContext,
  name = TARGET_NAME,
): Promise<string | null> {
  const res = await request.get("/api/targets");
  const data = (await res.json()) as { targets: { id: string; name: string }[] };
  return data.targets.find((t) => t.name === name)?.id ?? null;
}

export async function waitForRun(page: Page, runId: string, timeoutMs = 6 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await page.request.get(`/api/runs/${runId}/status`);
    const s = (await res.json()) as {
      status: string;
      scenarioCounts: Record<string, number>;
      budgetExhausted: string | null;
      statusReason: string | null;
    };
    if (["completed", "partial", "failed", "cancelled"].includes(s.status)) return s;
    if (Date.now() > deadline)
      throw new Error(`run ${runId} did not finish in time (last status ${s.status})`);
    await page.waitForTimeout(1500);
  }
}

export async function latestReadyPlanId(page: Page, targetId: string): Promise<string> {
  const res = await page.request.get(`/api/targets/${targetId}/plans`);
  const { plans } = (await res.json()) as { plans: { id: string; status: string }[] };
  const p = plans.find((x) => x.status === "ready");
  if (!p) throw new Error("no ready plan");
  return p.id;
}

export async function defaultBudgets(overrides: Record<string, number> = {}) {
  return {
    maxElapsedMinutes: 15,
    maxScenarios: 20,
    maxActionsPerScenario: 40,
    maxTotalActions: 400,
    maxInputTokens: 200000,
    maxOutputTokens: 40000,
    maxEstimatedCostUsd: 2,
    maxRepeatedActions: 5,
    maxConsecutiveBlocked: 3,
    ...overrides,
  };
}

export async function startRunViaApi(page: Page, planId: string, body: Record<string, unknown>) {
  const res = await apiPost(page, `/api/plans/${planId}/runs`, body);
  expect(res.status(), await res.text()).toBe(202);
  return ((await res.json()) as { runId: string }).runId;
}

export type ReportJson = {
  run: { status: string; budgetExhausted: string | null };
  provider: { isFake: boolean };
  summary: { completeness: string; scenarioCounts: Record<string, number> };
  scenarios: {
    key: string;
    status: string;
    reason: string | null;
    steps: { status: string; error: string | null }[];
  }[];
  findings: {
    key: string;
    category: string;
    source: string;
    scenarioKey?: string;
    title: string;
    evidence: { kind: string; artifactId?: string }[];
    standardsRefs: { standard: string; ref: string }[];
  }[];
};

export async function reportJson(page: Page, runId: string): Promise<ReportJson> {
  const res = await page.request.get(`/api/runs/${runId}/export?format=json`);
  expect(res.status()).toBe(200);
  return (await res.json()) as ReportJson;
}
