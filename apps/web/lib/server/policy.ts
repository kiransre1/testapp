import { validateAllowedOrigins } from "@testapp/core";
import { getEnv } from "./context";
import { HttpError } from "./api";

export function demoHostnames(): string[] {
  return getEnv()
    .DEMO_TARGET_HOSTNAMES.split(",")
    .map((h) => h.trim())
    .filter(Boolean);
}

/** Reject allowlists that include private/internal hosts without explicit opt-in. */
export function assertOriginsPermitted(
  allowedOrigins: string[],
  allowPrivateNetwork: boolean,
): void {
  const errors = validateAllowedOrigins({
    allowedOrigins,
    allowPrivateNetwork,
    demoMode: getEnv().DEMO_MODE,
    demoHostnames: demoHostnames(),
  });
  if (errors.length) throw new HttpError(422, "origin policy rejected the allowlist", errors);
}
