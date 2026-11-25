import { runConfigSchema } from "@testapp/core";
import { api, json, parseBody, requireUuid } from "@/lib/server/api";
import { startRun } from "@/lib/server/runs";

export const POST = api<{ id: string }>(async ({ req, params }) => {
  const config = await parseBody(req, runConfigSchema);
  const run = await startRun(requireUuid(params.id), config);
  return json({ runId: run.id }, 202);
});
