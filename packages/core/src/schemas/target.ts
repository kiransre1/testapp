import { z } from "zod";
import { locatorSchema } from "./plan";

const httpUrl = z
  .string()
  .trim()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "must be http or https")
  .refine((u) => {
    try {
      const p = new URL(u);
      return !p.username && !p.password;
    } catch {
      return false;
    }
  }, "credentials must not be embedded in the URL");

/** An origin: scheme://host[:port] with nothing else. */
export const originSchema = z
  .string()
  .trim()
  .refine((o) => {
    try {
      const u = new URL(o);
      return (
        (u.protocol === "http:" || u.protocol === "https:") && u.origin === o.replace(/\/$/, "")
      );
    } catch {
      return false;
    }
  }, "origin must look like https://staging.example.com (scheme, host, optional port only)")
  .transform((o) => o.replace(/\/$/, ""));

export const targetInputSchema = z
  .object({
    projectName: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(120),
    baseUrl: httpUrl,
    brief: z.string().trim().min(20, "brief must be at least 20 characters").max(100_000),
    authorizationConfirmed: z.literal(true, {
      message: "you must confirm you are authorised to test this target",
    }),
    isStaging: z.literal(true, {
      message: "target must be designated as a staging/test environment",
    }),
    allowedOrigins: z.array(originSchema).min(1).max(10),
    allowPrivateNetwork: z.boolean().default(false),
    allowDisposableWrites: z.boolean().default(false),
    prohibitedActionsSummary: z.string().max(5000).default(""),
    forbiddenSelectors: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
    forbiddenRoutes: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
    buildLabel: z.string().trim().max(200).optional(),
    seedResetNotes: z.string().max(5000).optional(),
    roleNotes: z.string().max(5000).optional(),
    startPath: z.string().trim().startsWith("/").max(500).default("/"),
    authMode: z.enum(["none", "form"]),
    loginUrl: httpUrl.optional(),
    usernameLocator: locatorSchema.optional(),
    passwordLocator: locatorSchema.optional(),
    submitLocator: locatorSchema.optional(),
    loginSuccessUrlContains: z.string().trim().max(300).optional(),
    loginSuccessLocator: locatorSchema.optional(),
    credentialUsername: z.string().max(500).optional(),
    credentialPassword: z.string().max(500).optional(),
    discoveryMaxPages: z.number().int().min(1).max(50).default(8),
    discoveryMaxDepth: z.number().int().min(0).max(4).default(2),
  })
  .strict()
  .superRefine((t, ctx) => {
    try {
      const origin = new URL(t.baseUrl).origin;
      if (!t.allowedOrigins.includes(origin)) {
        ctx.addIssue({
          code: "custom",
          path: ["allowedOrigins"],
          message: `the base URL origin ${origin} must be explicitly allowlisted`,
        });
      }
      if (t.loginUrl && !t.allowedOrigins.includes(new URL(t.loginUrl).origin)) {
        ctx.addIssue({
          code: "custom",
          path: ["loginUrl"],
          message: "login URL origin must be allowlisted",
        });
      }
    } catch {
      /* url errors reported by field validators */
    }
    if (t.authMode === "form") {
      if (!t.loginUrl)
        ctx.addIssue({ code: "custom", path: ["loginUrl"], message: "required for form login" });
      if (!t.loginSuccessUrlContains && !t.loginSuccessLocator) {
        ctx.addIssue({
          code: "custom",
          path: ["loginSuccessUrlContains"],
          message: "form login needs a success URL condition or a success locator",
        });
      }
    }
  });
export type TargetInput = z.infer<typeof targetInputSchema>;

/** Editable subset (project name and brief handled separately). */
export const targetUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    baseUrl: httpUrl.optional(),
    allowedOrigins: z.array(originSchema).min(1).max(10).optional(),
    allowPrivateNetwork: z.boolean().optional(),
    allowDisposableWrites: z.boolean().optional(),
    prohibitedActionsSummary: z.string().max(5000).optional(),
    forbiddenSelectors: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
    forbiddenRoutes: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
    buildLabel: z.string().trim().max(200).optional(),
    seedResetNotes: z.string().max(5000).optional(),
    roleNotes: z.string().max(5000).optional(),
    startPath: z.string().trim().startsWith("/").max(500).optional(),
    loginUrl: httpUrl.optional(),
    loginSuccessUrlContains: z.string().trim().max(300).optional(),
  })
  .strict();
export type TargetUpdate = z.infer<typeof targetUpdateSchema>;

export const credentialInputSchema = z
  .object({
    username: z.string().min(1).max(500),
    password: z.string().min(1).max(500),
  })
  .strict();
