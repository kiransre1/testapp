import { requestCancel } from "@testapp/db";
import { api, HttpError, json, requireUuid } from "@/lib/server/api";
import { getDb } from "@/lib/server/context";

/** Emergency stop: the worker checks this flag before every browser action. */
export const POST = api<{ id: string }>(async ({ params }) => {
  const run = await requestCancel(getDb(), requireUuid(params.id));
  if (!run) throw new HttpError(404, "not found");
  return json({ ok: true, status: run.status });
});
