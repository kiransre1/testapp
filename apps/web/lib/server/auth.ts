import { safeEqual } from "@testapp/core";
import { getSession, type SessionInfo } from "@testapp/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, getEnv } from "./context";

export const SESSION_COOKIE = "testapp_session";

export async function currentSession(): Promise<SessionInfo | null> {
  const jar = await cookies();
  return getSession(getDb(), jar.get(SESSION_COOKIE)?.value);
}

/** For server components/pages: redirect to /login when unauthenticated. */
export async function requireSession(): Promise<SessionInfo> {
  const s = await currentSession();
  if (!s) redirect("/login");
  return s;
}

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: getEnv().COOKIE_SECURE,
    path: "/",
    expires,
  };
}

/**
 * Same-origin check for state-changing requests. Accepts requests whose
 * Origin (or Referer) matches APP_BASE_URL or the request's own host.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin") ?? refererOrigin(req.headers.get("referer"));
  if (!origin) return false;
  const allowed = new Set<string>();
  try {
    allowed.add(new URL(getEnv().APP_BASE_URL).origin);
  } catch {
    /* ignore */
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  if (host) allowed.add(`${proto}://${host}`);
  return allowed.has(origin);
}

function refererOrigin(ref: string | null): string | null {
  if (!ref) return null;
  try {
    return new URL(ref).origin;
  } catch {
    return null;
  }
}

export function csrfValid(req: Request, session: SessionInfo): boolean {
  const token = req.headers.get("x-csrf-token");
  return Boolean(token) && safeEqual(token!, session.csrfToken) && isSameOrigin(req);
}

export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local").slice(0, 100);
}
