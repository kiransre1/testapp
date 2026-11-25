import { getPlan } from "@testapp/db";
import { api, HttpError, json, requireUuid } from "@/lib/server/api";
import { getDb } from "@/lib/server/context";

export const GET = api<{ id: string }>(async ({ params }) => {
  const plan = await getPlan(getDb(), requireUuid(params.id));
  if (!plan) throw new HttpError(404, "not found");
  return json(plan);
});
