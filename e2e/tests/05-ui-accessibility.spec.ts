import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { findTargetId, latestReadyPlanId, login } from "./helpers";

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`),
    label,
  ).toEqual([]);
}

test.describe("TestApp's own UI is keyboard-accessible and passes automated checks", () => {
  test("login page", async ({ page }) => {
    await page.goto("/login");
    await expectNoSeriousViolations(page, "login");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Email")).toBeFocused();
  });

  test("authenticated pages", async ({ page }) => {
    await login(page);
    const targetId = (await findTargetId(page.request)) ?? "";
    expect(targetId).not.toBe("");
    const planId = await latestReadyPlanId(page, targetId);
    const runs = await page.request.get(`/api/targets/${targetId}/plans`);
    expect(runs.ok()).toBe(true);
    for (const url of ["/", "/targets/new", `/targets/${targetId}`, `/plans/${planId}`, "/runs"]) {
      await page.goto(url);
      await expectNoSeriousViolations(page, url);
    }
    // A completed run page and its report.
    await page.goto("/runs");
    await page
      .getByRole("link", { name: /^[0-9a-f]{8}$/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: /Run/ }).first()).toBeVisible();
    await expectNoSeriousViolations(page, "run detail");
    // Skip link and visible focus for keyboard users.
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  });

  test("mobile viewport layout keeps primary navigation reachable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Runs" }),
    ).toBeVisible();
    await expectNoSeriousViolations(page, "dashboard (mobile)");
  });
});
