import { expect, type Page, test } from "@playwright/test";
import {
  apiPost,
  defaultBudgets,
  findTargetId,
  login,
  reportJson,
  startRunViaApi,
  waitForRun,
} from "./helpers";

type PlanResponse = {
  plan: { id: string; status: string };
  scenarios: { key: string; definition: Record<string, unknown> & { steps: unknown[] } }[];
};

async function freshPlan(page: Page, targetId: string): Promise<PlanResponse> {
  const res = await apiPost(page, `/api/targets/${targetId}/plans`, {});
  expect(res.status()).toBe(202);
  const { planId } = (await res.json()) as { planId: string };
  for (let i = 0; i < 60; i++) {
    const p = (await (await page.request.get(`/api/plans/${planId}`)).json()) as PlanResponse;
    if (p.plan.status === "ready") return p;
    await page.waitForTimeout(1000);
  }
  throw new Error("plan not ready");
}

async function patchScenario(page: Page, planId: string, key: string, definition: unknown) {
  return page.request.fetch(`/api/plans/${planId}/scenarios/${key}`, {
    method: "PATCH",
    data: { definition },
    headers: {
      "content-type": "application/json",
      "x-csrf-token": (await page.locator('meta[name="csrf-token"]').getAttribute("content")) ?? "",
      origin: new URL(page.url()).origin,
    },
  });
}

test.describe
  .serial("safety controls", () => {
    let targetId = "";
    let plan: PlanResponse;

    test.beforeEach(async ({ page }) => {
      await login(page);
      targetId = (await findTargetId(page.request)) ?? "";
      expect(targetId, "demo target from 02-demo must exist").not.toBe("");
    });

    test("plan editor rejects arbitrary script and unknown actions", async ({ page }) => {
      plan = await freshPlan(page, targetId);
      const sc = plan.scenarios.find((s) => s.key === "SC-001")!.definition;
      for (const bad of [
        { action: "evaluate", script: "document.cookie" },
        { action: "click", locator: { by: "css", value: "js=document.body" } },
        { action: "navigate", target: "javascript:alert(1)" },
        {
          action: "click",
          locator: { by: "role", role: "button", name: "x" },
          onClick: "alert(1)",
        },
      ]) {
        const res = await patchScenario(page, plan.plan.id, "SC-001", {
          ...sc,
          steps: [...sc.steps, bad],
        });
        expect(res.status(), JSON.stringify(bad)).toBe(422);
      }
    });

    test("non-allowlisted navigation is blocked and prompt-injection page text changes nothing", async ({
      page,
    }) => {
      const help = plan.scenarios.find((s) => s.key === "SC-008")!.definition;
      // Follow the injected link on the help page (a non-allowlisted origin).
      let res = await patchScenario(page, plan.plan.id, "SC-008", {
        ...help,
        maxActions: 10,
        steps: [
          ...help.steps,
          {
            action: "click",
            locator: { by: "role", role: "link", name: "our partner status page" },
          },
          { action: "assertUrl", contains: "evil.example.com" },
        ],
      });
      expect(res.status(), await res.text()).toBe(200);
      // Direct navigation to a non-allowlisted origin and to a cloud metadata address.
      const reports = plan.scenarios.find((s) => s.key === "SC-006")!.definition;
      res = await patchScenario(page, plan.plan.id, "SC-006", {
        ...reports,
        steps: [
          { action: "navigate", target: "http://169.254.169.254/latest/meta-data" },
          { action: "assertUrl", contains: "/" },
        ],
      });
      expect(res.status(), await res.text()).toBe(200);
      const runId = await startRunViaApi(page, plan.plan.id, {
        browserProfile: "chromium-desktop",
        budgets: await defaultBudgets(),
        scenarioKeys: ["SC-008", "SC-006"],
        analyse: false,
      });
      await waitForRun(page, runId);
      const r = await reportJson(page, runId);
      for (const key of ["SC-008", "SC-006"]) {
        const s = r.scenarios.find((x) => x.key === key)!;
        expect(s.status, `${key}: ${s.reason}`).toBe("blocked");
        expect(
          s.steps.some(
            (st) =>
              st.status === "blocked" &&
              /blocked by origin policy|not permitted|not allowlisted|always blocked/.test(
                st.error ?? "",
              ),
          ),
        ).toBe(true);
      }
      // Blocked automation is not reported as a target defect.
      expect(
        r.findings.filter(
          (f) =>
            f.category === "observed_failure" && ["SC-008", "SC-006"].includes(f.scenarioKey ?? ""),
        ),
      ).toHaveLength(0);
      // The injected text did not alter policy: the allowlist is unchanged.
      const target = (await (await page.request.get(`/api/targets/${targetId}`)).json()) as {
        target: { allowedOrigins: string[] };
      };
      expect(target.target.allowedOrigins.join(",")).not.toContain("evil");
    });

    test("prohibited destructive actions are never executed", async ({ page }) => {
      const sc = plan.scenarios.find((s) => s.key === "SC-001")!.definition;
      const res = await patchScenario(page, plan.plan.id, "SC-001", {
        ...sc,
        maxActions: 10,
        steps: [
          ...sc.steps.slice(0, 3),
          { action: "click", locator: { by: "role", role: "button", name: "Delete task" } },
        ],
      });
      expect(res.status(), await res.text()).toBe(200);
      const runId = await startRunViaApi(page, plan.plan.id, {
        browserProfile: "chromium-desktop",
        budgets: await defaultBudgets(),
        scenarioKeys: ["SC-001"],
        analyse: false,
      });
      await waitForRun(page, runId);
      const r = await reportJson(page, runId);
      const s = r.scenarios.find((x) => x.key === "SC-001")!;
      expect(s.status).toBe("blocked");
      expect(s.reason).toMatch(/deletion action, which is prohibited/);
      expect(s.steps).toHaveLength(0);
    });

    test("budget exhaustion stops work and produces a partial run", async ({ page }) => {
      const fresh = await freshPlan(page, targetId);
      const runId = await startRunViaApi(page, fresh.plan.id, {
        browserProfile: "chromium-desktop",
        budgets: await defaultBudgets({ maxTotalActions: 6 }),
        analyse: true,
      });
      const final = await waitForRun(page, runId);
      expect(final.status).toBe("partial");
      expect(final.budgetExhausted).toBe("maxTotalActions");
      const r = await reportJson(page, runId);
      expect(r.summary.completeness).toBe("partial");
      expect(r.scenarios.filter((s) => s.status === "skipped").length).toBeGreaterThan(0);
      await page.goto(`/runs/${runId}`);
      await expect(page.getByText(/does not represent complete coverage/)).toBeVisible();
    });

    test("emergency stop cancels the run and stops subsequent actions", async ({ page }) => {
      const fresh = await freshPlan(page, targetId);
      const runId = await startRunViaApi(page, fresh.plan.id, {
        browserProfile: "chromium-desktop",
        budgets: await defaultBudgets(),
        analyse: false,
      });
      // Wait until execution has started, then press the emergency stop in the UI.
      for (let i = 0; i < 120; i++) {
        const s = (await (await page.request.get(`/api/runs/${runId}/status`)).json()) as {
          status: string;
          scenarioCounts: Record<string, number>;
        };
        if (
          s.status === "running" &&
          (s.scenarioCounts.passed ?? 0) + (s.scenarioCounts.failed ?? 0) >= 1
        )
          break;
        await page.waitForTimeout(500);
      }
      await page.goto(`/runs/${runId}`);
      page.once("dialog", (d) => d.accept());
      await page.getByRole("button", { name: "Emergency stop" }).click();
      const final = await waitForRun(page, runId);
      expect(final.status).toBe("cancelled");
      const r = await reportJson(page, runId);
      expect(r.summary.completeness).toBe("cancelled");
      expect(r.scenarios.some((s) => s.status === "skipped" && /cancel/.test(s.reason ?? ""))).toBe(
        true,
      );
    });
  });
