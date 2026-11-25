import {
  decryptSecret,
  encryptSecret,
  redactDeep,
  type TargetInput,
  type TargetUpdate,
} from "@testapp/core";
import { and, desc, eq, max } from "drizzle-orm";
import type { Db } from "../client";
import { briefVersions, projects, runEvents, targetCredentials, targets } from "../schema";

export type TargetRow = typeof targets.$inferSelect;

/** Target view safe for APIs/UI: never includes credential material. */
export type PublicTarget = TargetRow & { projectName: string; hasCredential: boolean };

const aad = (targetId: string, field: "username" | "password") =>
  `target-credential:${targetId}:${field}`;

export async function logEvent(
  db: Db,
  e: {
    type: string;
    message: string;
    level?: "info" | "warn" | "error";
    runId?: string;
    targetId?: string;
    jobId?: string;
    data?: Record<string, unknown>;
    secrets?: string[];
  },
): Promise<void> {
  const secrets = e.secrets ?? [];
  await db.insert(runEvents).values({
    type: e.type,
    message: redactDeep(e.message, secrets),
    level: e.level ?? "info",
    runId: e.runId,
    targetId: e.targetId,
    jobId: e.jobId,
    data: e.data ? redactDeep(e.data, secrets) : undefined,
  });
}

export async function createTarget(
  db: Db,
  input: TargetInput,
  encryptionKey: string,
): Promise<string> {
  if (input.authMode === "form" && (!input.credentialUsername || !input.credentialPassword)) {
    throw new Error("form login requires a synthetic username and password");
  }
  return db.transaction(async (tx) => {
    const [existingProject] = await tx
      .select()
      .from(projects)
      .where(eq(projects.name, input.projectName))
      .limit(1);
    const projectId =
      existingProject?.id ??
      (
        await tx.insert(projects).values({ name: input.projectName }).returning({ id: projects.id })
      )[0]!.id;

    const [target] = await tx
      .insert(targets)
      .values({
        projectId,
        name: input.name,
        baseUrl: input.baseUrl,
        allowedOrigins: input.allowedOrigins,
        allowPrivateNetwork: input.allowPrivateNetwork,
        isStaging: input.isStaging,
        authorizationConfirmedAt: new Date(),
        allowDisposableWrites: input.allowDisposableWrites,
        prohibitedActionsSummary: input.prohibitedActionsSummary,
        forbiddenSelectors: input.forbiddenSelectors,
        forbiddenRoutes: input.forbiddenRoutes,
        buildLabel: input.buildLabel,
        seedResetNotes: input.seedResetNotes,
        roleNotes: input.roleNotes,
        startPath: input.startPath,
        authMode: input.authMode,
        loginUrl: input.loginUrl,
        usernameLocator: input.usernameLocator,
        passwordLocator: input.passwordLocator,
        submitLocator: input.submitLocator,
        loginSuccessUrlContains: input.loginSuccessUrlContains,
        loginSuccessLocator: input.loginSuccessLocator,
        discoveryMaxPages: input.discoveryMaxPages,
        discoveryMaxDepth: input.discoveryMaxDepth,
      })
      .returning({ id: targets.id });
    const targetId = target!.id;

    await tx.insert(briefVersions).values({ targetId, version: 1, content: input.brief });

    if (input.credentialUsername && input.credentialPassword) {
      await tx.insert(targetCredentials).values({
        targetId,
        usernameEnc: encryptSecret(
          input.credentialUsername,
          encryptionKey,
          aad(targetId, "username"),
        ),
        passwordEnc: encryptSecret(
          input.credentialPassword,
          encryptionKey,
          aad(targetId, "password"),
        ),
      });
    }
    await tx.insert(runEvents).values({
      targetId,
      type: "target.created",
      message: `target "${input.name}" created`,
      data: {
        origins: input.allowedOrigins,
        authMode: input.authMode,
        disposableWrites: input.allowDisposableWrites,
      },
    });
    return targetId;
  });
}

export async function getPublicTarget(db: Db, id: string): Promise<PublicTarget | null> {
  const [row] = await db
    .select({ target: targets, projectName: projects.name })
    .from(targets)
    .innerJoin(projects, eq(projects.id, targets.projectId))
    .where(eq(targets.id, id))
    .limit(1);
  if (!row) return null;
  const [cred] = await db
    .select({ id: targetCredentials.id })
    .from(targetCredentials)
    .where(eq(targetCredentials.targetId, id))
    .limit(1);
  return { ...row.target, projectName: row.projectName, hasCredential: Boolean(cred) };
}

export async function listTargets(db: Db) {
  return db
    .select({
      id: targets.id,
      name: targets.name,
      baseUrl: targets.baseUrl,
      projectId: projects.id,
      projectName: projects.name,
      createdAt: targets.createdAt,
    })
    .from(targets)
    .innerJoin(projects, eq(projects.id, targets.projectId))
    .orderBy(projects.name, targets.name);
}

export async function updateTarget(db: Db, id: string, patch: TargetUpdate): Promise<void> {
  const current = await getPublicTarget(db, id);
  if (!current) throw new Error("target not found");
  const origins = patch.allowedOrigins ?? current.allowedOrigins;
  const baseUrl = patch.baseUrl ?? current.baseUrl;
  if (!origins.includes(new URL(baseUrl).origin)) {
    throw new Error("the base URL origin must be explicitly allowlisted");
  }
  await db
    .update(targets)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(targets.id, id));
  await logEvent(db, {
    targetId: id,
    type: "target.updated",
    message: "target settings updated",
    data: { fields: Object.keys(patch) },
  });
}

export async function addBriefVersion(db: Db, targetId: string, content: string) {
  return db.transaction(async (tx) => {
    const [m] = await tx
      .select({ v: max(briefVersions.version) })
      .from(briefVersions)
      .where(eq(briefVersions.targetId, targetId));
    const version = (m?.v ?? 0) + 1;
    const [row] = await tx.insert(briefVersions).values({ targetId, version, content }).returning();
    return row!;
  });
}

export async function listBriefVersions(db: Db, targetId: string) {
  return db
    .select()
    .from(briefVersions)
    .where(eq(briefVersions.targetId, targetId))
    .orderBy(desc(briefVersions.version));
}

export async function getLatestBrief(db: Db, targetId: string) {
  const [row] = await db
    .select()
    .from(briefVersions)
    .where(eq(briefVersions.targetId, targetId))
    .orderBy(desc(briefVersions.version))
    .limit(1);
  return row ?? null;
}

export async function setCredential(
  db: Db,
  targetId: string,
  cred: { username: string; password: string },
  encryptionKey: string,
): Promise<void> {
  const values = {
    usernameEnc: encryptSecret(cred.username, encryptionKey, aad(targetId, "username")),
    passwordEnc: encryptSecret(cred.password, encryptionKey, aad(targetId, "password")),
    updatedAt: new Date(),
  };
  await db
    .insert(targetCredentials)
    .values({ targetId, label: "primary", ...values })
    .onConflictDoUpdate({
      target: [targetCredentials.targetId, targetCredentials.label],
      set: values,
    });
  await logEvent(db, {
    targetId,
    type: "credential.updated",
    message: "synthetic credential stored (encrypted)",
  });
}

/** Worker-only: decrypt the credential for injection at fill time. */
export async function getDecryptedCredential(
  db: Db,
  targetId: string,
  encryptionKey: string,
): Promise<{ username: string; password: string } | null> {
  const [row] = await db
    .select()
    .from(targetCredentials)
    .where(and(eq(targetCredentials.targetId, targetId), eq(targetCredentials.label, "primary")))
    .limit(1);
  if (!row) return null;
  return {
    username: decryptSecret(row.usernameEnc, encryptionKey, aad(targetId, "username")),
    password: decryptSecret(row.passwordEnc, encryptionKey, aad(targetId, "password")),
  };
}
