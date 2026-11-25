import type { Locator as SchemaLocator } from "@testapp/core";
import type { Locator, Page } from "playwright";

type AriaRole = Parameters<Page["getByRole"]>[0];

/** Translate a schema locator into a Playwright locator. Never evaluates page-supplied code. */
export function toPlaywrightLocator(page: Page, l: SchemaLocator): Locator {
  let loc: Locator;
  switch (l.by) {
    case "role":
      loc = page.getByRole(
        l.role as AriaRole,
        l.name ? { name: l.name, exact: l.exact ?? false } : {},
      );
      break;
    case "label":
      loc = page.getByLabel(l.value, { exact: l.exact ?? false });
      break;
    case "text":
      loc = page.getByText(l.value, { exact: l.exact ?? false });
      break;
    case "placeholder":
      loc = page.getByPlaceholder(l.value, { exact: l.exact ?? false });
      break;
    case "testId":
      loc = page.getByTestId(l.value);
      break;
    case "css":
      loc = page.locator(`css=${l.value}`);
      break;
  }
  return l.nth !== undefined ? loc.nth(l.nth) : loc;
}

export type Resolution =
  | { ok: true; locator: Locator; count: number }
  | { ok: false; reason: "not_found" | "ambiguous" | "not_visible"; count: number };

/** Resolve an interaction target to exactly one visible element, waiting briefly for it. */
export async function resolveSingle(
  page: Page,
  l: SchemaLocator,
  timeoutMs = 5_000,
): Promise<Resolution> {
  const loc = toPlaywrightLocator(page, l);
  const deadline = Date.now() + timeoutMs;
  let count = 0;
  while (Date.now() < deadline) {
    count = await loc.count().catch(() => 0);
    if (count === 1) {
      if (await loc.isVisible().catch(() => false)) return { ok: true, locator: loc, count };
    } else if (count > 1) {
      return { ok: false, reason: "ambiguous", count };
    }
    await page.waitForTimeout(200);
  }
  if (count === 1) return { ok: false, reason: "not_visible", count };
  return { ok: false, reason: count > 1 ? "ambiguous" : "not_found", count };
}

/** Accessible-ish description of a resolved element, used for live policy checks. */
export async function describeElement(loc: Locator): Promise<string> {
  const parts = await Promise.all([
    loc.getAttribute("aria-label").catch(() => null),
    loc.getAttribute("value").catch(() => null),
    loc.getAttribute("title").catch(() => null),
    loc.textContent({ timeout: 2_000 }).catch(() => null),
  ]);
  return parts.filter(Boolean).join(" ").slice(0, 300);
}
