import { hash, verify } from "@node-rs/argon2";
import { randomToken, sha256Hex } from "@testapp/core";
import { and, count, eq, gt, lt, sql } from "drizzle-orm";
import type { Db } from "../client";
import { loginAttempts, runEvents, sessions, users } from "../schema";

/** Argon2id with OWASP-recommended minimums (19 MiB, t=2, p=1). Algorithm 2 = Argon2id. */
const ARGON2_OPTS = { algorithm: 2 as const, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_ACCOUNT = 5;
export const MAX_FAILURES_PER_CLIENT = 20;
export const MIN_PASSWORD_LENGTH = 12;

// A real Argon2id hash of a random string, used to equalise timing for unknown accounts.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hash(randomToken(16), ARGON2_OPTS);
  return dummyHash;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function bootstrapAdmin(
  db: Db,
  email: string,
  password: string,
): Promise<"created" | "exists"> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`bootstrap password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (!/^[^@\s]+@[^@\s]+$/.test(email.trim())) throw new Error("bootstrap email is not valid");
  const [existing] = await db.select({ n: count() }).from(users);
  if ((existing?.n ?? 0) > 0) return "exists";
  const passwordHash = await hashPassword(password);
  // Single-user product: refuse to create a second user even under a race.
  const inserted = await db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE users IN EXCLUSIVE MODE`);
    const [again] = await tx.select({ n: count() }).from(users);
    if ((again?.n ?? 0) > 0) return false;
    await tx.insert(users).values({ email: normaliseEmail(email), passwordHash });
    await tx
      .insert(runEvents)
      .values({ type: "auth.bootstrap", message: "single admin user created" });
    return true;
  });
  return inserted ? "created" : "exists";
}

export type LoginResult =
  | { ok: true; token: string; csrfToken: string; expiresAt: Date }
  | { ok: false; reason: "invalid" | "rate_limited" };

export async function login(
  db: Db,
  input: { email: string; password: string; clientKey: string },
  now = new Date(),
): Promise<LoginResult> {
  const email = normaliseEmail(input.email);
  const accountKey = sha256Hex(`acct:${email}`);
  const clientKey = sha256Hex(`client:${input.clientKey}`);
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS);

  const failuresFor = async (keyHash: string) => {
    const [r] = await db
      .select({ n: count() })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.keyHash, keyHash),
          eq(loginAttempts.success, false),
          gt(loginAttempts.createdAt, since),
        ),
      );
    return r?.n ?? 0;
  };
  if (
    (await failuresFor(accountKey)) >= MAX_FAILURES_PER_ACCOUNT ||
    (await failuresFor(clientKey)) >= MAX_FAILURES_PER_CLIENT
  ) {
    return { ok: false, reason: "rate_limited" };
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let valid = false;
  if (user) {
    valid = await verifyPassword(user.passwordHash, input.password);
  } else {
    // Equalise timing for unknown accounts.
    await verifyPassword(await getDummyHash(), input.password);
  }

  if (!user || !valid) {
    await db.insert(loginAttempts).values([
      { keyHash: accountKey, success: false, createdAt: now },
      { keyHash: clientKey, success: false, createdAt: now },
    ]);
    return { ok: false, reason: "invalid" };
  }

  await db.insert(loginAttempts).values({ keyHash: accountKey, success: true, createdAt: now });
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    id: sha256Hex(token),
    userId: user.id,
    csrfToken,
    expiresAt,
    createdAt: now,
    lastSeenAt: now,
  });
  // Opportunistic cleanup of expired sessions and old attempts.
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.createdAt, new Date(now.getTime() - 24 * 3600 * 1000)));
  return { ok: true, token, csrfToken, expiresAt };
}

export type SessionInfo = {
  sessionId: string;
  userId: string;
  email: string;
  csrfToken: string;
  expiresAt: Date;
};

export async function getSession(
  db: Db,
  token: string | undefined,
  now = new Date(),
): Promise<SessionInfo | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const id = sha256Hex(token);
  const [row] = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      email: users.email,
      csrfToken: sessions.csrfToken,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  if (now.getTime() - row.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id));
  }
  const { lastSeenAt: _ignored, ...info } = row;
  return info;
}

export async function logout(db: Db, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.id, sha256Hex(token)));
}
