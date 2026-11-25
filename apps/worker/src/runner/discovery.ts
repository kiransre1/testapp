import { checkNavigation, classifyText, isForbiddenRoute, truncate } from "@testapp/core";
import type { DiscoverySummary } from "@testapp/db";
import type { BrowserContext } from "playwright";
import type { TargetPolicy } from "./browser";

type PageSummary = DiscoverySummary["pages"][number];

/**
 * Fixed, TestApp-authored extraction script (never model- or page-supplied).
 * Everything it returns is treated as untrusted data.
 */
const EXTRACT = () => {
  const text = (el: Element | null | undefined) =>
    (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const labelFor = (el: Element): string => {
    const id = el.getAttribute("id");
    const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    return (
      el.getAttribute("aria-label") ||
      text(byFor) ||
      text(el.closest("label")) ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      ""
    );
  };
  const forms = Array.from(document.querySelectorAll("form"))
    .slice(0, 10)
    .map((f, i) => ({
      name:
        f.getAttribute("aria-label") || text(f.querySelector("h1,h2,h3,legend")) || `form ${i + 1}`,
      fields: Array.from(f.querySelectorAll("input,select,textarea"))
        .filter((e) => (e as HTMLInputElement).type !== "hidden")
        .slice(0, 20)
        .map((e) => ({
          label: labelFor(e),
          type: (e as HTMLInputElement).type || e.tagName.toLowerCase(),
          required: (e as HTMLInputElement).required,
        })),
      submit: Array.from(f.querySelectorAll('button,input[type="submit"]'))
        .slice(0, 5)
        .map((b) => text(b) || (b as HTMLInputElement).value || ""),
    }));
  return {
    title: document.title,
    headings: Array.from(document.querySelectorAll("h1,h2,h3"))
      .slice(0, 15)
      .map((h) => text(h)),
    links: Array.from(document.querySelectorAll("a[href]"))
      .slice(0, 80)
      .map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: text(a) || a.getAttribute("aria-label") || "",
      })),
    forms,
    buttons: Array.from(document.querySelectorAll("button,[role=button]"))
      .slice(0, 30)
      .map((b) => text(b) || b.getAttribute("aria-label") || ""),
    landmarks: Array.from(document.querySelectorAll("main,nav,header,footer,aside,[role]"))
      .slice(0, 20)
      .map((e) => e.getAttribute("role") || e.tagName.toLowerCase()),
  };
};

const SKIP_LINK = /log ?out|sign ?out|unsubscribe/i;

/** Bounded same-origin breadth-first discovery using GET navigations only. */
export async function discover(
  context: BrowserContext,
  startUrl: string,
  policy: TargetPolicy,
  limits: { maxPages: number; maxDepth: number },
): Promise<DiscoverySummary> {
  const origin = new URL(startUrl).origin;
  const queue: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }];
  const seen = new Set<string>();
  const pages: PageSummary[] = [];
  let truncated = false;
  const page = await context.newPage();
  try {
    while (queue.length) {
      const next = queue.shift()!;
      const u = new URL(next.url);
      u.hash = "";
      const key = `${u.pathname}${u.search}`;
      if (seen.has(key)) continue;
      if (pages.length >= limits.maxPages) {
        truncated = true;
        break;
      }
      seen.add(key);
      try {
        const res = await page.goto(u.toString(), {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });
        if (!res || !(res.headers()["content-type"] ?? "").includes("html")) continue;
      } catch {
        continue;
      }
      const landed = new URL(page.url());
      if (landed.origin !== origin) continue;
      const data = await page.evaluate(EXTRACT).catch(() => null);
      if (!data) continue;
      const links: string[] = [];
      for (const l of data.links) {
        let lu: URL;
        try {
          lu = new URL(l.href);
        } catch {
          continue;
        }
        if (lu.origin !== origin) continue;
        if (SKIP_LINK.test(l.text) || SKIP_LINK.test(lu.pathname)) continue;
        const cls = classifyText(`${l.text} ${lu.pathname.replace(/[/_-]+/g, " ")}`);
        if (cls === "purchase" || cls === "deletion" || cls === "external_message") continue;
        if (
          isForbiddenRoute(lu, policy.forbiddenRoutes) ||
          !checkNavigation(lu.toString(), policy).allowed
        )
          continue;
        links.push(lu.pathname);
        if (next.depth < limits.maxDepth) queue.push({ url: lu.toString(), depth: next.depth + 1 });
      }
      pages.push({
        path: landed.pathname,
        title: truncate(data.title, 200),
        headings: data.headings.map((h) => truncate(h, 150)).filter(Boolean),
        links: [...new Set(links)].slice(0, 40),
        forms: data.forms.map((f) => ({
          name: truncate(f.name, 100),
          fields: f.fields.map((x) => ({
            label: truncate(x.label, 100),
            type: x.type,
            required: x.required,
          })),
          submit: f.submit.map((s) => truncate(s, 60)),
        })),
        buttons: [...new Set(data.buttons.map((b) => truncate(b, 60)).filter(Boolean))],
        landmarks: [...new Set(data.landmarks)],
      });
    }
  } finally {
    await page.close().catch(() => undefined);
  }
  return { pages, truncated: truncated || queue.length > 0 };
}
