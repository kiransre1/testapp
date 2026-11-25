import { formatIssues } from "@testapp/core";
import type { SessionInfo } from "@testapp/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { csrfValid, currentSession } from "./auth";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: string[],
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

type Handler<P> = (ctx: { req: Request; session: SessionInfo; params: P }) => Promise<Response>;

/**
 * Wrap an API route: requires an authenticated session for every method and a
 * valid CSRF token + same-origin for state-changing methods. Errors never echo
 * internal details or secret values.
 */
export function api<P = Record<string, string>>(handler: Handler<P>) {
  return async (req: Request, routeCtx: { params: Promise<P> }) => {
    try {
      const session = await currentSession();
      if (!session) return json({ error: "unauthenticated" }, 401);
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !csrfValid(req, session)) {
        return json({ error: "csrf check failed" }, 403);
      }
      const params = (await routeCtx.params) as P;
      return await handler({ req, session, params });
    } catch (err) {
      if (err instanceof HttpError)
        return json({ error: err.message, details: err.details }, err.status);
      console.error(
        JSON.stringify({
          msg: "api error",
          route: new URL(req.url).pathname,
          error: err instanceof Error ? err.message : "unknown",
        }),
      );
      return json({ error: "internal error" }, 500);
    }
  };
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw new HttpError(415, "expected application/json");
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(422, "validation failed", formatIssues(parsed.error));
  return parsed.data;
}

export const uuidParam = z.string().uuid();
export function requireUuid(v: string | undefined): string {
  const r = uuidParam.safeParse(v);
  if (!r.success) throw new HttpError(404, "not found");
  return r.data;
}
