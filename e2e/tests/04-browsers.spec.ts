import { expect, test } from "@playwright/test";
import {
  defaultBudgets,
  findTargetId,
  latestReadyPlanId,
  login,
  reportJson,
  startRunViaApi,
  waitForRun,
} from "./helpers";

/**
 * Browser coverage executed BY the TestApp worker against the demo target:
 * mobile-viewport Chromium (core smoke + responsive defect) and Firefox/WebKit smoke.
 */
test.describe
  .serial("worker browser coverage", () => {
    let planId = "";

    test.beforeEach(async ({ page }) => {
      await login(page);
      const targetId = (await findTargetId(page.request)) ?? "";
      expect(targetId).not.toBe("");
      planId = await latestReadyPlanId(page, targetId);
    });

    test("mobile-viewport Chromium: core smoke passes and the responsive navigation defect is detected", async ({
      page,
    }) => {
      const runId = await startRunViaApi(page, planId, {
        browserProfile: "chromium-mobile",
        budgets: await defaultBudgets(),
        scenarioKeys: ["SC-001", "SC-002", "SC-009", "SC-010"],
        analyse: false,
      });
      const final = await waitForRun(page, runId);
      expect(final.status).toBe("completed");
      const r = await reportJson(page, runId);
      const st = Object.fromEntries(r.scenarios.map((s) => [s.key, s.status]));
      expect(st["SC-001"]).toBe("passed");
      expect(st["SC-002"]).toBe("passed");
      expect(st["SC-010"]).toBe("passed");
      expect(st["SC-009"]).toBe("failed");
      expect(
        r.findings.some((f) => f.category === "observed_failure" && f.scenarioKey === "SC-009"),
      ).toBe(true);
    });

    for (const profile of ["firefox-desktop", "webkit-desktop"] as const) {
      test(`${profile}: smoke scenarios execute and pass`, async ({ page }) => {
        const runId = await startRunViaApi(page, planId, {
          browserProfile: profile,
          budgets: await defaultBudgets(),
          scenarioKeys: ["SC-001", "SC-009", "SC-010"],
          analyse: false,
        });
        const final = await waitForRun(page, runId);
        expect(final.status, final.statusReason ?? "").toBe("completed");
        const r = await reportJson(page, runId);
        for (const s of r.scenarios)
          expect(s.status, `${profile} ${s.key}: ${s.reason}`).toBe("passed");
      });
    }
  });
