import { targetUpdateSchema } from "@testapp/core";
import { getPublicTarget, updateTarget } from "@testapp/db";
import { api, HttpError, json, parseBody, requireUuid } from "@/lib/server/api";
import { getDb } from "@/lib/server/context";
import { assertOriginsPermitted } from "@/lib/server/policy";

type P = { id: string };

/** Public target view. Credential material is never included. */
export const GET = api<P>(async ({ params }) => {
  const target = await getPublicTarget(getDb(), requireUuid(params.id));
  if (!target) throw new HttpError(404, "not found");
  return json({ target });
});

export const PATCH = api<P>(async ({ req, params }) => {
  const id = requireUuid(params.id);
  const patch = await parseBody(req, targetUpdateSchema);
  const current = await getPublicTarget(getDb(), id);
  if (!current) throw new HttpError(404, "not found");
  assertOriginsPermitted(
    patch.allowedOrigins ?? current.allowedOrigins,
    patch.allowPrivateNetwork ?? current.allowPrivateNetwork,
  );
  try {
    await updateTarget(getDb(), id, patch);
  } catch (e) {
    throw new HttpError(422, e instanceof Error ? e.message : "update failed");
  }
  return json({ ok: true });
});
