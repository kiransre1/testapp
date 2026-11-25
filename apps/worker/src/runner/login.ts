import type { BrowserProfile, Locator as SchemaLocator } from "@testapp/core";
import type { Browser, BrowserContext, Locator, Page } from "playwright";
import { newPolicyContext, type TargetPolicy } from "./browser";
import { resolveSingle, toPlaywrightLocator } from "./locate";

export type LoginConfig = {
  loginUrl: string;
  usernameLocator: SchemaLocator | null;
  passwordLocator: SchemaLocator | null;
  submitLocator: SchemaLocator | null;
  loginSuccessUrlContains: string | null;
  loginSuccessLocator: SchemaLocator | null;
};

export type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export type LoginResult =
  | { ok: true; storageState: StorageState; finalUrl: string }
  | { ok: false; detail: string; finalUrl?: string };

async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const c of candidates) {
    const n = await c.count().catch(() => 0);
    for (let i = 0; i < Math.min(n, 5); i++) {
      const el = c.nth(i);
      if (await el.isVisible().catch(() => false)) return el;
    }
  }
  return null;
}

async function pick(
  page: Page,
  explicit: SchemaLocator | null,
  auto: Locator[],
): Promise<Locator | null> {
  if (explicit) {
    const r = await resolveSingle(page, explicit);
    return r.ok ? r.locator : null;
  }
  return firstVisible(auto);
}

/**
 * Sign in with the synthetic credential in a dedicated context that is never
 * traced or screenshotted. Secrets are only used for the two fill calls.
 * The resulting storage state is kept in memory for this run only.
 */
export async function performLogin(
  browser: Browser,
  profile: BrowserProfile,
  policy: TargetPolicy,
  cfg: LoginConfig,
  cred: { username: string; password: string },
): Promise<LoginResult> {
  const { context, blocked } = await newPolicyContext(browser, profile, policy);
  try {
    const page = await context.newPage();
    try {
      await page.goto(cfg.loginUrl, { waitUntil: "domcontentloaded" });
    } catch {
      return {
        ok: false,
        detail: blocked[0]
          ? `login URL blocked: ${blocked[0].reason}`
          : "login page could not be loaded",
      };
    }
    const user = await pick(page, cfg.usernameLocator, [
      page.getByLabel(/e-?mail|user ?name|login|user id/i),
      page.locator('input[type="email"]'),
      page.locator('input[autocomplete="username"]'),
      page.locator(
        'input[name*="user" i], input[name*="email" i], input[id*="user" i], input[id*="email" i]',
      ),
      page.locator('input[type="text"]'),
    ]);
    const pass = await pick(page, cfg.passwordLocator, [page.locator('input[type="password"]')]);
    if (!user)
      return {
        ok: false,
        detail: "could not find the username field (configure an explicit locator)",
        finalUrl: page.url(),
      };
    if (!pass)
      return {
        ok: false,
        detail: "could not find the password field (configure an explicit locator)",
        finalUrl: page.url(),
      };
    await user.fill(cred.username);
    await pass.fill(cred.password);
    const submit = await pick(page, cfg.submitLocator, [
      page.getByRole("button", { name: /sign ?in|log ?in|continue|submit/i }),
      page.locator('button[type="submit"], input[type="submit"]'),
    ]);
    if (submit) {
      await submit.click();
    } else {
      await pass.press("Enter");
    }
    try {
      if (cfg.loginSuccessUrlContains) {
        const needle = cfg.loginSuccessUrlContains;
        await page.waitForURL((u) => u.toString().includes(needle), { timeout: 15_000 });
      }
      if (cfg.loginSuccessLocator) {
        await toPlaywrightLocator(page, cfg.loginSuccessLocator)
          .first()
          .waitFor({ state: "visible", timeout: 15_000 });
      }
    } catch {
      return {
        ok: false,
        detail: "login could not be verified: success condition not met within 15s",
        finalUrl: page.url(),
      };
    }
    return { ok: true, storageState: await context.storageState(), finalUrl: page.url() };
  } finally {
    await context.close().catch(() => undefined);
  }
}
