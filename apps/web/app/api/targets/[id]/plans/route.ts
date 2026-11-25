import {
  createPlanVersion,
  enqueueJob,
  getLatestBrief,
  getPublicTarget,
  listPlans,
  logEvent,
} from "@testapp/db";
import { api, HttpError, json, requireUuid } from "@/lib/server/api";
import { getDb, getEnv } from "@/lib/server/context";

type P = { id: string };

export const GET = api<P>(async ({ params }) =>
  json({ plans: await listPlans(getDb(), requireUuid(params.id)) }),
);

/** Queue plan generation in the worker (never inside the request handler). */
export const POST = api<P>(async ({ params }) => {
  const id = requireUuid(params.id);
  const db = getDb();
  const target = await getPublicTarget(db, id);
  if (!target) throw new HttpError(404, "not found");
  const brief = await getLatestBrief(db, id);
  const env = getEnv();
  const isFake = env.LLM_PROVIDER === "fake";
  const plan = await createPlanVersion(db, {
    targetId: id,
    briefVersionId: brief?.id ?? null,
    provider: env.LLM_PROVIDER,
    model: isFake ? "fake-deterministic-v1" : (env.ANTHROPIC_MODEL ?? null),
    isFake,
  });
  const job = await enqueueJob(db, "generate_plan", { targetId: id, planVersionId: plan.id });
  await logEvent(db, {
    targetId: id,
    jobId: job.id,
    type: "plan.requested",
    message: `plan v${plan.version} requested (${env.LLM_PROVIDER})`,
  });
  return json({ planId: plan.id, version: plan.version }, 202);
});
