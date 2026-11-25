import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, csrf, login } from "./helpers";

test.describe("single-user authentication and session protection", () => {
  test("protected pages redirect and APIs reject unauthenticated requests", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    for (const url of [
      "/api/targets",
      "/api/artifacts/00000000-0000-0000-0000-000000000000",
      "/api/runs/00000000-0000-0000-0000-000000000000/status",
    ]) {
      const res = await request.get(url);
      expect(res.status(), url).toBe(401);
    }
    const health = await request.get("/api/health");
    expect(await health.json()).toEqual({ ok: true });
  });

  test("there is no public registration", async ({ request }) => {
    for (const url of ["/register", "/signup", "/api/auth/register"]) {
      const res = await request.post(url, { data: {}, failOnStatusCode: false });
      expect([404, 405]).toContain(res.status());
    }
  });

  test("wrong password is rejected without revealing which field was wrong", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("#login-error")).toHaveText("invalid email or password");
  });

  test("cross-origin login attempts are rejected", async ({ request }) => {
    const res = await request.post("/api/auth/login", {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      headers: { origin: "https://evil.example.com" },
    });
    expect(res.status()).toBe(403);
  });

  test("login sets an HttpOnly SameSite session cookie and CSRF is enforced", async ({
    page,
    context,
  }) => {
    await login(page);
    const cookie = (await context.cookies()).find((c) => c.name === "testapp_session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    // Mutation without CSRF token -> 403
    const noToken = await page.request.post("/api/targets", {
      data: {},
      headers: { "content-type": "application/json", origin: new URL(page.url()).origin },
    });
    expect(noToken.status()).toBe(403);
    // Valid token but foreign origin -> 403
    const foreign = await page.request.post("/api/targets", {
      data: {},
      headers: {
        "content-type": "application/json",
        "x-csrf-token": await csrf(page),
        origin: "https://evil.example.com",
      },
    });
    expect(foreign.status()).toBe(403);
    // Logout invalidates the session server-side
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get("/api/targets")).status()).toBe(401);
  });
});
