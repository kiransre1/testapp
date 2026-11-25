import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  apiPost,
  DEMO_BRIEF,
  DEMO_PASSWORD,
  DEMO_URL,
  DEMO_USERNAME,
  findTargetId,
  login,
  reportJson,
  TARGET_NAME,
  waitForRun,
} from "./helpers";

/**
 * The complete fake-provider vertical slice, driven through the UI:
 * create target -> preflight -> plan -> real Playwright execution in the worker
 * -> findings with evidence -> exports -> fix packet -> rerun -> comparison.
 */
test.describe
  .serial("demo vertical slice (desktop Chromium)", () => {
    let targetId = "";
    let planId = "";
    let runId = "";

    test.beforeEach(async ({ page }) => {
      await login(page);
    });

    test("create the demo target with a synthetic credential", async ({ page }) => {
      await page.getByRole("link", { name: "New target" }).click();
      await page.getByLabel("Project name").fill("Demo");
      await page.getByLabel("Target name").fill(TARGET_NAME);
      await page.getByLabel("Base staging URL").fill(`${DEMO_URL}/`);
      await page.getByLabel("Build / version label").fill("demo-1.0");
      await page.getByLabel(/Application brief/).fill(DEMO_BRIEF);
      await page.getByLabel("I am authorised to test this target.").check();
      await page.getByLabel(/This is a staging\/test environment/).check();
      await page.getByLabel(/Allowlisted origins/).fill(DEMO_URL);
      await page.getByLabel(/Allow creating and editing disposable/).check();
      await page.getByLabel("Login URL").fill(`${DEMO_URL}/login`);
      await page.getByLabel("Post-login starting path").fill("/tasks");
      await page.getByLabel("Success: URL contains").fill("/tasks");
      await page.getByLabel("Synthetic username").fill(DEMO_USERNAME);
      await page.getByLabel("Synthetic password").fill(DEMO_PASSWORD);
      await page.getByRole("button", { name: "Create target" }).click();
      await expect(page.getByRole("heading", { name: TARGET_NAME })).toBeVisible();
      targetId = (await findTargetId(page.request)) ?? "";
      expect(targetId).not.toBe("");
      await expect(page.getByText("credential stored")).toBeVisible();
      // The target API never returns credential material.
      const body = await (await page.request.get(`/api/targets/${targetId}`)).text();
      expect(body).not.toContain(DEMO_PASSWORD);
      expect(body).not.toContain("passwordEnc");
      expect(body).not.toContain("v1:");
    });

    test("preflight passes, including login and bounded discovery", async ({ page }) => {
      await page.goto(`/targets/${targetId}`);
      await page.getByRole("button", { name: "Run preflight" }).click();
      await expect(page.getByRole("heading", { name: /Latest: passed/ })).toBeVisible({
        timeout: 120_000,
      });
      for (const check of [
        "URL and origin allowlist",
        "Target reachable",
        "Authentication",
        "Post-login starting point",
        "Bounded discovery",
      ]) {
        await expect(page.getByRole("row", { name: new RegExp(check) })).toContainText("passed");
      }
    });

    test("generate a plan with the fake provider and inspect it", async ({ page }) => {
      await page.goto(`/targets/${targetId}`);
      await page.getByRole("button", { name: "Generate plan" }).click();
      await expect(page).toHaveURL(/\/plans\//);
      planId = page.url().split("/plans/")[1]!;
      await expect(page.getByRole("heading", { name: /Test plan v1/ })).toContainText("ready", {
        timeout: 60_000,
      });
      await expect(page.getByText("fake provider").first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Coverage matrix" })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: /SC-005 v1: Edited task title/ }),
      ).toBeVisible();
      // Plan JSON never contains the credential value.
      const plan = await (await page.request.get(`/api/plans/${planId}`)).text();
      expect(plan).not.toContain(DEMO_PASSWORD);
    });

    test("execute the plan through the real worker and detect the deliberate defects", async ({
      page,
    }) => {
      await page.goto(`/plans/${planId}`);
      await page.getByRole("button", { name: "Start run" }).click();
      await expect(page).toHaveURL(/\/runs\//);
      runId = page.url().split("/runs/")[1]!;
      const final = await waitForRun(page, runId);
      expect(final.status, final.statusReason ?? "").toBe("completed");

      const r = await reportJson(page, runId);
      const status = Object.fromEntries(r.scenarios.map((s) => [s.key, s.status]));
      // Valid core journeys pass.
      expect(status["SC-001"]).toBe("passed");
      expect(status["SC-002"]).toBe("passed");
      expect(status["SC-003"]).toBe("passed");
      expect(status["SC-004"]).toBe("passed");
      expect(status["SC-010"]).toBe("passed");
      // Deliberate functional defect (edit not persisted).
      expect(status["SC-005"]).toBe("failed");
      const editFailure = r.findings.find(
        (f) => f.category === "observed_failure" && f.scenarioKey === "SC-005",
      );
      expect(editFailure, "edit persistence defect must be an observed failure").toBeTruthy();
      // Deliberate runtime symptom (uncaught TypeError on /reports).
      const pageError = r.findings.find(
        (f) => f.category === "observed_runtime_symptom" && /TypeError/.test(f.title),
      );
      expect(pageError, "reports page error must be captured").toBeTruthy();
      const runtimeTitles = r.findings
        .filter((f) => f.category === "observed_runtime_symptom")
        .map((f) => f.title);
      expect(
        runtimeTitles.some((t) => /Server error 500/.test(t)),
        runtimeTitles.join(" | "),
      ).toBe(true);
      // axe accessibility result (unlabeled filter input).
      const axe = r.findings.find(
        (f) => f.category === "automated_standard_result" && f.title.includes('"label"'),
      );
      expect(axe, "axe label violation must be reported").toBeTruthy();
      expect(axe!.standardsRefs.some((s) => s.standard === "WCAG 2.2")).toBe(true);
      // Every observed finding links to real, retrievable evidence.
      for (const f of r.findings.filter(
        (x) => x.category.startsWith("observed") || x.category === "automated_standard_result",
      )) {
        const ids = f.evidence.map((e) => e.artifactId).filter(Boolean) as string[];
        expect(ids.length, `${f.key} evidence`).toBeGreaterThan(0);
        const res = await page.request.get(`/api/artifacts/${ids[0]}`);
        expect(res.status(), `${f.key} artifact`).toBe(200);
      }
      // Inferred/LLM-derived recommendations are never labelled as observed bugs.
      for (const f of r.findings.filter((x) => x.source === "llm_analysis")) {
        expect(["heuristic_observation", "inferred_risk", "enhancement_opportunity"]).toContain(
          f.category,
        );
        expect(f.evidence.some((e) => e.artifactId)).toBe(false);
      }
      expect(r.provider.isFake).toBe(true);
    });

    test("run detail UI shows results, filters findings and serves artifacts privately", async ({
      page,
      browser,
    }) => {
      await page.goto(`/runs/${runId}`);
      await expect(page.getByRole("heading", { name: /Run/ }).first()).toContainText("completed");
      await expect(
        page.getByText(/Fake provider: the plan and recommendations are deterministic fixtures/),
      ).toBeVisible();
      await page.getByLabel("Category").selectOption({ label: "Observed failure" });
      await expect(page.getByText(/shown/)).toContainText(/^\d+ of \d+ shown$/);
      const r = await reportJson(page, runId);
      const artifactId = r.findings
        .find((f) => f.category === "observed_failure")!
        .evidence.find((e) => e.artifactId)!.artifactId!;
      // A fresh, unauthenticated context cannot read the artifact.
      const anon = await browser.newContext();
      const res = await anon.request.get(
        new URL(`/api/artifacts/${artifactId}`, page.url()).toString(),
      );
      expect(res.status()).toBe(401);
      await anon.close();
    });

    test("exports: HTML, Markdown, schema-valid JSON and the fix packet", async ({ page }) => {
      const html = await page.request.get(`/api/runs/${runId}/export?format=html`);
      expect(html.status()).toBe(200);
      const htmlText = await html.text();
      expect(htmlText).toContain("Fake provider used");
      expect(htmlText).toContain("3. Bugs and runtime symptoms");
      const md = await (await page.request.get(`/api/runs/${runId}/export?format=md`)).text();
      for (const h of [
        "## 1. Executive summary",
        "## 2. Coverage matrix",
        "## 5. Agentic opportunities",
        "## 6. Standards-informed observations",
        "## 8. Regression suite",
      ]) {
        expect(md).toContain(h);
      }
      const json = await reportJson(page, runId);
      // Validate against the shared report schema.
      const { reportSchema } = await import("@testapp/core");
      expect(reportSchema.safeParse(json).success).toBe(true);
      const fix = await (
        await page.request.get(`/api/runs/${runId}/export?format=fixpacket`)
      ).text();
      expect(fix).toContain("Instructions for the coding assistant");
      expect(fix).toContain("Do not blindly trust the speculative section");
      expect(fix).toMatch(/F-\d{3}/);
      expect(fix).toContain("Steps to reproduce");
      for (const text of [htmlText, md, JSON.stringify(json), fix]) {
        expect(text).not.toContain(DEMO_PASSWORD);
      }
      // UI: fix packet copy/download controls
      await page.goto(`/runs/${runId}`);
      await page.getByRole("button", { name: "Show fix packet" }).click();
      await expect(page.getByLabel(/Fix packet \(ready to paste/)).toContainText(
        "Instructions for the coding assistant",
      );
      await page.goto(`/runs/${runId}/report`);
      await expect(page.getByRole("heading", { name: "4. UI/UX findings" })).toBeVisible();
    });

    test("rerun a single scenario, retain history and compare", async ({ page }) => {
      const res = await apiPost(page, `/api/runs/${runId}/rerun`, {
        scenarioKeys: ["SC-005", "SC-002"],
      });
      expect(res.status()).toBe(202);
      const rerunId = ((await res.json()) as { runId: string }).runId;
      const final = await waitForRun(page, rerunId);
      expect(final.status).toBe("completed");
      await page.goto(`/runs/compare?base=${runId}&head=${rerunId}`);
      await expect(page.getByRole("heading", { name: "Compare runs" })).toBeVisible();
      // The edit defect persists; findings from scenarios not rerun are not_retested, never resolved.
      await expect(page.getByRole("row", { name: /persistent.*SC-005/ }).first()).toBeVisible();
      await expect(page.getByRole("row", { name: /not retested/ }).first()).toBeVisible();
      await expect(page.getByRole("row", { name: /resolved/ })).toHaveCount(0);
      // History retained: both runs listed.
      await page.goto("/runs");
      await expect(page.getByRole("link", { name: runId.slice(0, 8) })).toBeVisible();
      await expect(page.getByRole("link", { name: rerunId.slice(0, 8) })).toBeVisible();
    });

    test("fixture plan and brief do not leak the documented defect list", async () => {
      const fixture = readFileSync(
        path.resolve(process.cwd(), "packages/core/fixtures/plans/taskpad-demo.json"),
        "utf8",
      );
      expect(fixture).not.toMatch(/DELIBERATE DEFECT/i);
    });
  });
