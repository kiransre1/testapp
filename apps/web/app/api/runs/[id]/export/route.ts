import { schema } from "@testapp/db";
import { and, eq } from "drizzle-orm";
import { api, HttpError, requireUuid } from "@/lib/server/api";
import { getDb } from "@/lib/server/context";

const KIND = {
  json: "report_json",
  md: "report_md",
  html: "report_html",
  fixpacket: "fix_packet",
} as const;

/** Redirect to the stored export artifact for a run (authenticated). */
export const GET = api<{ id: string }>(async ({ req, params }) => {
  const runId = requireUuid(params.id);
  const format = new URL(req.url).searchParams.get("format") as keyof typeof KIND | null;
  if (!format || !(format in KIND))
    throw new HttpError(400, "format must be json, md, html or fixpacket");
  const [art] = await getDb()
    .select({ id: schema.artifacts.id })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.runId, runId), eq(schema.artifacts.kind, KIND[format])));
  if (!art) throw new HttpError(404, "report not generated yet");
  const dl = new URL(req.url).searchParams.get("download") === "1" ? "?download=1" : "";
  // Relative Location keeps the browser on the same origin (and cookie scope) behind any proxy.
  return new Response(null, {
    status: 303,
    headers: { location: `/api/artifacts/${art.id}${dl}`, "cache-control": "no-store" },
  });
});
