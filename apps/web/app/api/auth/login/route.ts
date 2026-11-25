import { login } from "@testapp/db";
import { z } from "zod";
import { clientKey, isSameOrigin, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/auth";
import { getDb } from "@/lib/server/context";
import { json } from "@/lib/server/api";

const bodySchema = z
  .object({ email: z.string().min(1).max(320), password: z.string().min(1).max(1000) })
  .strict();

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return json({ error: "cross-origin login rejected" }, 403);
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return json({ error: "email and password are required" }, 400);
  }
  const result = await login(getDb(), { ...body, clientKey: clientKey(req) });
  if (!result.ok) {
    return result.reason === "rate_limited"
      ? json({ error: "too many failed attempts; try again later" }, 429)
      : json({ error: "invalid email or password" }, 401);
  }
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt));
  return res;
}
