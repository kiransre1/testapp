import { enqueueJob, getPublicTarget, logEvent, schema } from "@testapp/db";
import { desc, eq } from "drizzle-orm";
import { api, HttpError, json, requireUuid } from "@/lib/server/api";
import { getDb } from "@/lib/server/context";

type P = { id: string };

export const GET = api<P>(async ({ params }) => {
  const id = requireUuid(params.id);
  const rows = await getDb()
    .select()
    .from(schema.preflights)
    .where(eq(schema.preflights.targetId, id))
    .orderBy(desc(schema.preflights.createdAt))
    .limit(10);
  return json({ preflights: rows });
});

export const POST = api<P>(async ({ params }) => {
  const id = requireUuid(params.id);
  const db = getDb();
  if (!(await getPublicTarget(db, id))) throw new HttpError(404, "not found");
  const [pf] = await db.insert(schema.preflights).values({ targetId: id }).returning();
  const job = await enqueueJob(db, "preflight", { preflightId: pf!.id, targetId: id });
  await logEvent(db, {
    targetId: id,
    jobId: job.id,
    type: "preflight.requested",
    message: "preflight queued",
  });
  return json({ preflightId: pf!.id }, 202);
});
