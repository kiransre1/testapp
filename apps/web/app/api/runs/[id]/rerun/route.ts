import { getRun } from "@testapp/db";
import { z } from "zod";
import { api, HttpError, json, parseBody, requireUuid } from "@/lib/server/api";
import { getDb } from "@/lib/server/context";
import { startRun } from "@/lib/server/runs";

const bodySchema = z
  .object({
    scenarioKeys: z
      .array(z.string().regex(/^[A-Z][A-Z0-9]{1,5}-\d{3}$/))
      .max(200)
      .optional(),
    browserProfile: z
      .enum(["chromium-desktop", "chromium-mobile", "firefox-desktop", "webkit-desktop"])
      .optional(),
  })
  .strict();

/** Rerun the same plan (or selected scenarios) with the same budgets. */
export const POST = api<{ id: string }>(async ({ req, params }) => {
  const prev = await getRun(getDb(), requireUuid(params.id));
  if (!prev) throw new HttpError(404, "not found");
  const body = await parseBody(req, bodySchema);
  const run = await startRun(
    prev.planVersionId,
    {
      ...prev.config,
      browserProfile: body.browserProfile ?? prev.config.browserProfile,
      scenarioKeys: body.scenarioKeys?.length ? body.scenarioKeys : prev.config.scenarioKeys,
    },
    prev.id,
  );
  return json({ runId: run.id }, 202);
});
