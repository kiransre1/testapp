import { getSql } from "@/lib/server/context";

export const dynamic = "force-dynamic";

/** Unauthenticated liveness/readiness probe. Reveals nothing beyond up/down. */
export async function GET() {
  try {
    await getSql()`select 1`;
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
