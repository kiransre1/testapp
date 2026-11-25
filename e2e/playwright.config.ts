import { defineConfig } from "@playwright/test";

/**
 * Product end-to-end tests. They drive the TestApp web UI (desktop Chromium)
 * against a running stack: web + worker + PostgreSQL + demo target. The
 * TestApp worker itself runs desktop/mobile Chromium, Firefox and WebKit
 * against the demo target as part of these tests.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 10 * 60 * 1000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "../playwright-report", open: "never" }]],
  outputDir: "../test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
