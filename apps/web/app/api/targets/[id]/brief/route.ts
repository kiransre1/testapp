import { addBriefVersion, getPublicTarget } from "@testapp/db";
import { z } from "zod";
import { api, HttpError, json, parseBody, requireUuid } from "@/lib/server/api";
import { getDb } from "@/lib/server/context";

const schema = z.object({ content: z.string().trim().min(20).max(100_000) }).strict();

export const POST = api<{ id: string }>(async ({ req, params }) => {
  const id = requireUuid(params.id);
  if (!(await getPublicTarget(getDb(), id))) throw new HttpError(404, "not found");
  const { content } = await parseBody(req, schema);
  const row = await addBriefVersion(getDb(), id, content);
  return json({ version: row.version }, 201);
});
