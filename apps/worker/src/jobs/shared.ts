import { getDecryptedCredential, type PublicTarget } from "@testapp/db";
import type { WorkerContext } from "../context";
import type { TargetPolicy } from "../runner/browser";
import type { LoginConfig } from "../runner/login";

export function targetPolicy(ctx: WorkerContext, t: PublicTarget): TargetPolicy {
  return {
    allowedOrigins: t.allowedOrigins,
    allowPrivateNetwork: t.allowPrivateNetwork,
    demoMode: ctx.env.DEMO_MODE,
    demoHostnames: ctx.env.DEMO_TARGET_HOSTNAMES.split(",")
      .map((h) => h.trim())
      .filter(Boolean),
    forbiddenRoutes: t.forbiddenRoutes,
  };
}

export function loginConfig(t: PublicTarget): LoginConfig | null {
  if (t.authMode !== "form" || !t.loginUrl) return null;
  return {
    loginUrl: t.loginUrl,
    usernameLocator: t.usernameLocator,
    passwordLocator: t.passwordLocator,
    submitLocator: t.submitLocator,
    loginSuccessUrlContains: t.loginSuccessUrlContains,
    loginSuccessLocator: t.loginSuccessLocator,
  };
}

export async function loadCredential(ctx: WorkerContext, targetId: string) {
  return getDecryptedCredential(ctx.db, targetId, ctx.env.APP_ENCRYPTION_KEY);
}
