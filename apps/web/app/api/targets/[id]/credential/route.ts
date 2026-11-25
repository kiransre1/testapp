import { credentialInputSchema } from "@testapp/core";
import { getPublicTarget, setCredential } from "@testapp/db";
import { api, HttpError, json, parseBody, requireUuid } from "@/lib/server/api";
import { getDb, getEnv } from "@/lib/server/context";

/** Write-only: credentials can be replaced but are never returned. */
export const PUT = api<{ id: string }>(async ({ req, params }) => {
  const id = requireUuid(params.id);
  if (!(await getPublicTarget(getDb(), id))) throw new HttpError(404, "not found");
  const cred = await parseBody(req, credentialInputSchema);
  await setCredential(getDb(), id, cred, getEnv().APP_ENCRYPTION_KEY);
  return json({ ok: true, hasCredential: true });
});
