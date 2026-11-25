import { budgetsSchema, checkNavigation, redactDeep } from "@testapp/core";
import { getPublicTarget, logEvent, type PreflightCheck, schema } from "@testapp/db";
import { eq } from "drizzle-orm";
import type { Browser } from "playwright";
import type { WorkerContext } from "../context";
import { launchBrowser, newPolicyContext } from "../runner/browser";
import { discover } from "../runner/discovery";
import { saveArtifact } from "../runner/evidence";
import { performLogin, type StorageState } from "../runner/login";
import { loadCredential, loginConfig, targetPolicy } from "./shared";

export async function markPreflightInterrupted(
  ctx: WorkerContext,
  preflightId: string,
): Promise<void> {
  await ctx.db
    .update(schema.preflights)
    .set({
      status: "failed",
      error: "interrupted: worker stopped during preflight",
      finishedAt: new Date(),
    })
    .where(eq(schema.preflights.id, preflightId));
}

/**
 * Preflight: verify URL/allowlist, storage, browser, reachability, HTML,
 * redirects, authentication and the post-login start page, then run a bounded
 * discovery pass. Fails clearly (and early) instead of continuing.
 */
export async function handlePreflight(
  ctx: WorkerContext,
  payload: Record<string, string>,
): Promise<void> {
  const { preflightId, targetId } = payload;
  if (!preflightId || !targetId) throw new Error("preflight payload is missing ids");
  const target = await getPublicTarget(ctx.db, targetId);
  if (!target) throw new Error("target not found");
  await ctx.db
    .update(schema.preflights)
    .set({ status: "running" })
    .where(eq(schema.preflights.id, preflightId));

  const checks: PreflightCheck[] = [];
  const policy = targetPolicy(ctx, target);
  const cred =
    target.authMode === "form" ? await loadCredential(ctx, targetId).catch(() => null) : null;
  const secrets = cred ? [cred.username, cred.password] : [];
  const add = (name: string, ok: boolean | "skipped", detail: string) => {
    checks.push({
      name,
      status: ok === "skipped" ? "skipped" : ok ? "passed" : "failed",
      detail: redactDeep(detail, secrets),
    });
    return ok !== false;
  };
  const save = async (
    status: "passed" | "failed",
    error: string | null,
    discovery: unknown = null,
  ) => {
    await ctx.db
      .update(schema.preflights)
      .set({ status, checks, error, discovery: discovery as never, finishedAt: new Date() })
      .where(eq(schema.preflights.id, preflightId));
    await logEvent(ctx.db, {
      targetId,
      type: `preflight.${status}`,
      message: error ?? "preflight passed",
      secrets,
    });
  };

  let browser: Browser | null = null;
  try {
    // 1. URL + allowlist
    const nav = checkNavigation(target.baseUrl, policy);
    if (
      !add(
        "URL and origin allowlist",
        nav.allowed,
        nav.allowed
          ? `${new URL(target.baseUrl).origin} is allowlisted (${nav.hostClass})`
          : nav.reason,
      )
    ) {
      return save("failed", "base URL is not permitted by the origin policy");
    }
    // 2. Budgets / run configuration defaults
    const budgets = budgetsSchema.safeParse({
      maxElapsedMinutes: ctx.env.DEFAULT_MAX_ELAPSED_MINUTES,
      maxScenarios: ctx.env.DEFAULT_MAX_SCENARIOS,
      maxActionsPerScenario: ctx.env.DEFAULT_MAX_ACTIONS_PER_SCENARIO,
      maxTotalActions: ctx.env.DEFAULT_MAX_TOTAL_ACTIONS,
      maxInputTokens: ctx.env.DEFAULT_MAX_INPUT_TOKENS,
      maxOutputTokens: ctx.env.DEFAULT_MAX_OUTPUT_TOKENS,
      maxEstimatedCostUsd: ctx.env.DEFAULT_MAX_ESTIMATED_COST_USD,
      maxRepeatedActions: ctx.env.DEFAULT_MAX_REPEATED_ACTIONS,
      maxConsecutiveBlocked: ctx.env.DEFAULT_MAX_CONSECUTIVE_BLOCKED,
    });
    if (
      !add(
        "Run configuration and budgets",
        budgets.success,
        budgets.success ? "default budgets are valid" : "default budgets are invalid",
      )
    ) {
      return save("failed", "invalid budget configuration");
    }
    // 3. Artifact storage
    try {
      await ctx.store.healthCheck();
      add("Artifact storage", true, "private storage writable and readable");
    } catch (e) {
      add("Artifact storage", false, e instanceof Error ? e.message : "storage error");
      return save("failed", "artifact storage is not operational");
    }
    // 4. Browser
    try {
      browser = await launchBrowser("chromium-desktop");
      add("Browser", true, `Chromium ${browser.version()} launched`);
    } catch (e) {
      add("Browser", false, e instanceof Error ? e.message.split("\n")[0]! : "launch failed");
      return save("failed", "browser could not be launched");
    }
    // 5/6. Reachability, HTML, redirects
    const { context, blocked } = await newPolicyContext(browser, "chromium-desktop", policy);
    try {
      const page = await context.newPage();
      let status = 0;
      let contentType = "";
      try {
        const res = await page.goto(target.baseUrl, { waitUntil: "domcontentloaded" });
        status = res?.status() ?? 0;
        contentType = res?.headers()["content-type"] ?? "";
      } catch (e) {
        if (blocked.length) {
          add("Redirects stay on permitted origins", false, blocked[0]!.reason);
          return save("failed", "target redirected to a non-permitted destination");
        }
        add(
          "Target reachable",
          false,
          e instanceof Error ? e.message.split("\n")[0]! : "unreachable",
        );
        return save("failed", "target is not reachable");
      }
      if (!add("Target reachable", status > 0 && status < 500, `HTTP ${status}`))
        return save("failed", `target returned HTTP ${status}`);
      add(
        "Redirects stay on permitted origins",
        blocked.length === 0,
        blocked.length ? blocked[0]!.reason : `landed on ${new URL(page.url()).origin}`,
      );
      if (blocked.length) return save("failed", "target redirected to a non-permitted destination");
      const html = contentType.includes("html") && (await page.locator("body").count()) > 0;
      if (
        !add(
          "Plausible HTML application",
          html,
          html
            ? `content-type ${contentType.split(";")[0]}`
            : `unexpected content-type "${contentType}"`,
        )
      ) {
        return save("failed", "target did not return an HTML application");
      }
    } finally {
      await context.close().catch(() => undefined);
    }
    // 7. Authentication
    let storageState: StorageState | null = null;
    const lc = loginConfig(target);
    if (lc) {
      if (!cred) {
        add("Authentication", false, "form login configured but no synthetic credential is stored");
        return save("failed", "missing credential");
      }
      const login = await performLogin(browser, "chromium-desktop", policy, lc, cred);
      if (
        !add(
          "Authentication",
          login.ok,
          login.ok ? `signed in; landed on ${new URL(login.finalUrl).pathname}` : login.detail,
        )
      ) {
        return save("failed", "login could not be verified");
      }
      if (login.ok) storageState = login.storageState;
    } else {
      add("Authentication", "skipped", "no authentication configured");
    }
    // 8. Post-login starting point + 9. discovery
    const startUrl = new URL(target.startPath, target.baseUrl).toString();
    const disc = await newPolicyContext(browser, "chromium-desktop", policy, {
      storageState: storageState ?? undefined,
    });
    try {
      const p = await disc.context.newPage();
      let ok = false;
      let detail = "";
      try {
        const res = await p.goto(startUrl, { waitUntil: "domcontentloaded" });
        const landed = new URL(p.url());
        const bouncedToLogin = lc
          ? landed.pathname === new URL(lc.loginUrl).pathname &&
            target.startPath !== landed.pathname
          : false;
        ok = Boolean(res && res.status() < 400 && !bouncedToLogin);
        detail = bouncedToLogin
          ? "redirected back to the login page"
          : `HTTP ${res?.status()} at ${landed.pathname}`;
      } catch (e) {
        detail = e instanceof Error ? e.message.split("\n")[0]! : "navigation failed";
      }
      await p.close();
      if (!add("Post-login starting point", ok, detail))
        return save("failed", "starting page is not available");
      const discovery = await discover(disc.context, startUrl, policy, {
        maxPages: target.discoveryMaxPages,
        maxDepth: target.discoveryMaxDepth,
      });
      const safeDiscovery = redactDeep(discovery, secrets);
      add(
        "Bounded discovery",
        true,
        `${discovery.pages.length} page(s)${discovery.truncated ? " (truncated by limits)" : ""}`,
      );
      await saveArtifact(ctx, {
        kind: "discovery",
        label: "Discovery summary",
        data: Buffer.from(JSON.stringify(safeDiscovery, null, 2)),
        preflightId,
      });
      return save("passed", null, safeDiscovery);
    } finally {
      await disc.context.close().catch(() => undefined);
    }
  } catch (e) {
    add("Unexpected error", false, e instanceof Error ? e.message.split("\n")[0]! : "error");
    return save("failed", "preflight crashed");
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
