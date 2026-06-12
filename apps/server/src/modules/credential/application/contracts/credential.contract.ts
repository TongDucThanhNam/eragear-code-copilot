import { z } from "zod";

export const CredentialKindSchema = z.enum([
  "api_key",
  "oauth_token",
  "bearer_token",
  "secret",
]);

export const CredentialRecordSchema = z
  .object({
    id: z.string().trim().min(1),
    userId: z.string().trim().min(1),
    name: z.string().trim().min(1),
    kind: CredentialKindSchema,
    providerId: z.string().trim().min(1).optional(),
    projectId: z.string().trim().min(1).optional(),
    agentId: z.string().trim().min(1).optional(),
    secretPreview: z.string(),
    metadata: z.record(z.string(), z.string()).optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    secretUpdatedAt: z.number().int().nonnegative(),
    lastUsedAt: z.number().int().nonnegative().optional(),
  })
  .strict();

export const CredentialListInputSchema = z
  .object({
    providerId: z.string().trim().min(1).optional(),
    projectId: z.string().trim().min(1).optional(),
    agentId: z.string().trim().min(1).optional(),
    kind: CredentialKindSchema.optional(),
  })
  .strict()
  .optional();

export const CredentialListResultSchema = z
  .object({
    credentials: z.array(CredentialRecordSchema),
    totalCount: z.number().int().nonnegative(),
  })
  .strict();

export const UpsertCredentialInputSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(120),
    kind: CredentialKindSchema,
    providerId: z.string().trim().min(1).max(120).optional(),
    projectId: z.string().trim().min(1).optional(),
    agentId: z.string().trim().min(1).optional(),
    secret: z.string().min(1).max(200_000),
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const DeleteCredentialInputSchema = z
  .object({
    id: z.string().trim().min(1),
  })
  .strict();

export const DeleteCredentialResultSchema = z
  .object({
    deleted: z.boolean(),
  })
  .strict();

export const ResolveCredentialSecretInputSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    providerId: z.string().trim().min(1).optional(),
    kind: CredentialKindSchema.optional(),
    name: z.string().trim().min(1).optional(),
  })
  .strict();

export type CredentialKind = z.infer<typeof CredentialKindSchema>;
export type CredentialRecord = z.infer<typeof CredentialRecordSchema>;
export type CredentialListInput = z.infer<typeof CredentialListInputSchema>;
export type CredentialListResult = z.infer<typeof CredentialListResultSchema>;
export type UpsertCredentialInput = z.infer<typeof UpsertCredentialInputSchema>;
export type DeleteCredentialInput = z.infer<typeof DeleteCredentialInputSchema>;
export type DeleteCredentialResult = z.infer<
  typeof DeleteCredentialResultSchema
>;
export type ResolveCredentialSecretInput = z.infer<
  typeof ResolveCredentialSecretInputSchema
>;
