import type { Action, Locator } from "@testapp/core";

export function describeLocator(l: Locator): string {
  const nth = "nth" in l && l.nth !== undefined ? ` [#${l.nth}]` : "";
  switch (l.by) {
    case "role":
      return `${l.role}${l.name ? ` "${l.name}"` : ""}${nth}`;
    case "label":
      return `field labelled "${l.value}"${nth}`;
    case "text":
      return `text "${l.value}"${nth}`;
    case "placeholder":
      return `placeholder "${l.value}"${nth}`;
    case "testId":
      return `test id "${l.value}"${nth}`;
    case "css":
      return `css ${l.value}${nth}`;
  }
}

/** Human-readable step description. Secret references are shown as references, never values. */
export function describeAction(a: Action): string {
  switch (a.action) {
    case "navigate":
      return `Go to ${a.target}`;
    case "click":
      return `Click ${describeLocator(a.locator)}`;
    case "fill":
      return `Fill ${describeLocator(a.locator)} with ${typeof a.value === "string" ? `"${a.value}"` : `‹secret: ${a.value.secretRef}›`}`;
    case "select":
      return `Select "${a.option}" in ${describeLocator(a.locator)}`;
    case "check":
      return `${a.checked ? "Check" : "Uncheck"} ${describeLocator(a.locator)}`;
    case "press":
      return `Press ${a.key}${a.locator ? ` in ${describeLocator(a.locator)}` : ""}`;
    case "waitFor":
      return a.locator
        ? `Wait for ${describeLocator(a.locator)} to be ${a.state}`
        : `Wait for URL containing "${a.urlContains}"`;
    case "reload":
      return "Reload the page";
    case "assertVisible":
      return `Expect ${describeLocator(a.locator)} to be ${a.visible ? "visible" : "hidden"}`;
    case "assertText":
      return `Expect ${describeLocator(a.locator)} to ${a.match === "equals" ? "equal" : "contain"} "${a.text}"`;
    case "assertUrl":
      return a.pathEquals
        ? `Expect path to equal ${a.pathEquals}`
        : `Expect URL to contain "${a.contains}"`;
    case "assertCount":
      return `Expect count of ${describeLocator(a.locator)} ${{ eq: "=", gte: "≥", lte: "≤" }[a.comparison]} ${a.count}`;
    case "runAccessibilityCheck":
      return `Run automated accessibility check${a.label ? ` (${a.label})` : ""}`;
    case "screenshot":
      return `Capture screenshot "${a.label}"`;
  }
}
