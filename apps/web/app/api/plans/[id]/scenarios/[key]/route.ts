import { setScenarioEnabled, updateScenarioDefinition } from "@testapp/db";
import { z } from "zod";
import { api, HttpError, json, parseBody, requireUuid } from "@/lib/server/api";
import { getDb } from "@/lib/server/context";

const bodySchema = z.union([
  z.object({ enabled: z.boolean() }).strict(),
  z.object({ definition: z.unknown() }).strict(),
]);

export const PATCH = api<{ id: string; key: string }>(async ({ req, params }) => {
  const planId = requireUuid(params.id);
  const key = decodeURIComponent(params.key);
  if (!/^[A-Z][A-Z0-9]{1,5}-\d{3}$/.test(key)) throw new HttpError(404, "not found");
  const body = await parseBody(req, bodySchema);
  if ("enabled" in body) {
    if (!(await setScenarioEnabled(getDb(), planId, key, body.enabled)))
      throw new HttpError(404, "not found");
    return json({ ok: true });
  }
  const r = await updateScenarioDefinition(getDb(), planId, key, body.definition);
  if (!r.ok) throw new HttpError(422, "scenario rejected", r.errors);
  return json({ ok: true, version: r.scenario.version });
});
