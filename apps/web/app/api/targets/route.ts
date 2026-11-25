import { targetInputSchema } from "@testapp/core";
import { createTarget, listTargets } from "@testapp/db";
import { api, json, parseBody } from "@/lib/server/api";
import { getDb, getEnv } from "@/lib/server/context";
import { assertOriginsPermitted } from "@/lib/server/policy";

export const GET = api(async () => json({ targets: await listTargets(getDb()) }));

export const POST = api(async ({ req }) => {
  const input = await parseBody(req, targetInputSchema);
  assertOriginsPermitted(input.allowedOrigins, input.allowPrivateNetwork);
  const id = await createTarget(getDb(), input, getEnv().APP_ENCRYPTION_KEY);
  return json({ id }, 201);
});
