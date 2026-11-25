import {
  type BrowserProfile,
  checkNavigation,
  checkSubresource,
  isForbiddenRoute,
  type OriginPolicy,
  PROFILE_DETAILS,
  sanitizeUrl,
} from "@testapp/core";
import {
  type Browser,
  type BrowserContext,
  chromium,
  devices,
  firefox,
  type Page,
  type Route,
  webkit,
} from "playwright";

export type BlockedNavigation = { url: string; reason: string; at: string };

export type TargetPolicy = OriginPolicy & { forbiddenRoutes: readonly string[] };

export async function launchBrowser(profile: BrowserProfile): Promise<Browser> {
  const engine = PROFILE_DETAILS[profile].engine;
  const launcher = engine === "firefox" ? firefox : engine === "webkit" ? webkit : chromium;
  return launcher.launch({ headless: true, timeout: 60_000 });
}

export function contextOptions(profile: BrowserProfile) {
  const d = PROFILE_DETAILS[profile];
  if (d.isMobile) {
    const phone = devices["Pixel 7"];
    return {
      viewport: d.viewport,
      userAgent: phone?.userAgent,
      deviceScaleFactor: phone?.deviceScaleFactor ?? 2,
      isMobile: true,
      hasTouch: true,
    };
  }
  return { viewport: d.viewport };
}

/**
 * Create an isolated context whose every request is policy-checked:
 *  - top-level navigations (including each redirect hop, via fetch-and-fulfil)
 *    must stay on allowlisted origins and outside forbidden routes;
 *  - subresources may not use odd schemes or hit metadata/link-local hosts.
 * Downloads and service workers are disabled. Blocked navigations are recorded.
 */
export async function newPolicyContext(
  browser: Browser,
  profile: BrowserProfile,
  policy: TargetPolicy,
  opts: { storageState?: Awaited<ReturnType<BrowserContext["storageState"]>> } = {},
): Promise<{ context: BrowserContext; blocked: BlockedNavigation[] }> {
  const blocked: BlockedNavigation[] = [];
  const context = await browser.newContext({
    ...contextOptions(profile),
    acceptDownloads: false,
    serviceWorkers: "block",
    ignoreHTTPSErrors: false,
    javaScriptEnabled: true,
    storageState: opts.storageState,
  });
  context.setDefaultTimeout(8_000);
  context.setDefaultNavigationTimeout(20_000);

  const record = (url: string, reason: string) =>
    blocked.push({ url: sanitizeUrl(url), reason, at: new Date().toISOString() });

  const engine = PROFILE_DETAILS[profile].engine;
  await context.route("**/*", async (route) => {
    // The handler must never throw: an unhandled rejection here would crash the worker.
    try {
      await handleRoute(route);
    } catch {
      await route.abort("failed").catch(() => undefined);
    }
  });

  async function handleRoute(route: Route): Promise<void> {
    const req = route.request();
    const url = req.url();
    let isTopLevel = false;
    try {
      isTopLevel = req.isNavigationRequest() && req.frame() === req.frame().page().mainFrame();
    } catch {
      isTopLevel = req.isNavigationRequest();
    }
    if (!isTopLevel) {
      const sub = checkSubresource(url);
      if (!sub.allowed) {
        record(url, sub.reason ?? "blocked subresource");
        await route.abort("blockedbyclient");
        return;
      }
      if (req.isNavigationRequest()) {
        // iframes: same origin rules as top-level navigations
        const d = checkNavigation(url, policy);
        if (!d.allowed) {
          record(url, `frame: ${d.reason}`);
          await route.abort("blockedbyclient");
          return;
        }
      }
      await route.continue();
      return;
    }
    const d = checkNavigation(url, policy);
    if (!d.allowed) {
      record(url, d.reason);
      await route.abort("blockedbyclient");
      return;
    }
    if (isForbiddenRoute(d.url, policy.forbiddenRoutes)) {
      record(url, `route ${d.url.pathname} is forbidden for this target`);
      await route.abort("blockedbyclient");
      return;
    }
    // Fetch without following redirects so each hop is checked before the browser follows it.
    const response = await route.fetch({ maxRedirects: 0, timeout: 20_000 });
    const status = response.status();
    const location = status >= 300 && status < 400 ? response.headers().location : undefined;
    if (!location) {
      await route.fulfill({ response });
      return;
    }
    const next = checkNavigation(location, policy, url);
    if (!next.allowed) {
      record(new URL(location, url).toString(), `redirect: ${next.reason}`);
      await route.abort("blockedbyclient");
      return;
    }
    if (engine !== "webkit") {
      // Chromium/Firefox follow a fulfilled redirect; the next hop re-enters this handler.
      await route.fulfill({ response });
      return;
    }
    // WebKit cannot fulfil 3xx responses. The request was already sent once (by
    // route.fetch), so re-sending it would double-submit forms. Instead, hand
    // the browser a same-tab GET to the already policy-checked Location, carrying
    // any Set-Cookie headers from the redirect response.
    if (status === 307 || status === 308) {
      if (req.method() !== "GET") {
        record(
          next.url.toString(),
          "WebKit: method-preserving redirects (307/308) are not supported by the policy proxy",
        );
        await route.abort("blockedbyclient");
        return;
      }
    }
    const cookies = response
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => h.value);
    const target = next.url.toString().replace(/"/g, "%22");
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // Playwright splits multiple cookies on newlines.
        ...(cookies.length ? { "set-cookie": cookies.join("\n") } : {}),
      },
      body: `<!doctype html><meta http-equiv="refresh" content="0;url=${target}"><title>Redirecting</title>`,
    });
  }

  context.on("page", (page) => {
    // Popups/new tabs: the route above still applies; we only observe them.
    page.on("framenavigated", () => undefined);
  });
  return { context, blocked };
}

/** Screenshot with password fields masked. */
export async function safeScreenshot(page: Page): Promise<Buffer | null> {
  try {
    return await page.screenshot({
      fullPage: false,
      mask: [page.locator('input[type="password"]')],
      maskColor: "#222",
      animations: "disabled",
      timeout: 10_000,
    });
  } catch {
    return null;
  }
}
