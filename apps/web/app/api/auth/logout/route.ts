import { logout } from "@testapp/db";
import { cookies } from "next/headers";
import { csrfValid, currentSession, SESSION_COOKIE } from "@/lib/server/auth";
import { getDb } from "@/lib/server/context";
import { json } from "@/lib/server/api";

export async function POST(req: Request) {
  const session = await currentSession();
  if (session && !csrfValid(req, session)) return json({ error: "csrf check failed" }, 403);
  const jar = await cookies();
  await logout(getDb(), jar.get(SESSION_COOKIE)?.value);
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    path: "/",
    expires: new Date(0),
    httpOnly: true,
    sameSite: "lax",
  });
  return res;
}
