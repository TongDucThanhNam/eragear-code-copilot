import { z } from "zod";

export const AcpAuthMethodSchema = z.enum([
  "api_key",
  "bearer_token",
  "oauth_token",
  "external_cli",
]);

export const AcpAuthSyncStatusSchema = z.enum([
  "pending",
  "synced",
  "disabled",
  "missing_credential",
  "error",
]);

export const AcpAuthMetadataSchema = z.record(z.string(), z.string());

export const AcpAuthRecordSchema = z
  .object({
    userId: z.string().min(1),
    providerId: z.string().min(1),
    displayName: z.string().min(1).optional(),
    method: AcpAuthMethodSchema,
    credentialId: z.string().min(1).optional(),
    envKey: z.string().min(1).optional(),
    authFilePath: z.string().min(1),
    enabled: z.boolean(),
    metadata: AcpAuthMetadataSchema.optional(),
    syncStatus: AcpAuthSyncStatusSchema,
    syncError: z.string().min(1).optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    lastSyncedAt: z.number().int().nonnegative().optional(),
  })
  .strict();

export const ListAcpAuthInputSchema = z
  .object({
    providerId: z.string().trim().min(1).optional(),
    includeDisabled: z.boolean().optional(),
  })
  .strict()
  .optional();

export const UpsertAcpAuthInputSchema = z
  .object({
    providerId: z.string().trim().min(1),
    displayName: z.string().trim().min(1).max(160).optional(),
    method: AcpAuthMethodSchema,
    credentialId: z.string().trim().min(1).optional(),
    envKey: z.string().trim().min(1).max(120).optional(),
    authFilePath: z.string().trim().min(1).max(500).optional(),
    enabled: z.boolean().optional(),
    metadata: AcpAuthMetadataSchema.optional(),
  })
  .strict();

export const DeleteAcpAuthInputSchema = z
  .object({
    providerId: z.string().trim().min(1),
  })
  .strict();

export const SyncAcpAuthInputSchema = z
  .object({
    providerId: z.string().trim().min(1).optional(),
  })
  .strict()
  .optional();

export const AcpAuthListResultSchema = z
  .object({
    providers: z.array(AcpAuthRecordSchema),
    totalCount: z.number().int().nonnegative(),
  })
  .strict();

export const AcpAuthSyncResultSchema = z
  .object({
    providers: z.array(AcpAuthRecordSchema),
    totalCount: z.number().int().nonnegative(),
    syncedAt: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
  })
  .strict();

export type AcpAuthMethod = z.infer<typeof AcpAuthMethodSchema>;
export type AcpAuthSyncStatus = z.infer<typeof AcpAuthSyncStatusSchema>;
export type AcpAuthRecord = z.infer<typeof AcpAuthRecordSchema>;
export type ListAcpAuthInput = z.infer<typeof ListAcpAuthInputSchema>;
export type UpsertAcpAuthInput = z.infer<typeof UpsertAcpAuthInputSchema>;
export type DeleteAcpAuthInput = z.infer<typeof DeleteAcpAuthInputSchema>;
export type SyncAcpAuthInput = z.infer<typeof SyncAcpAuthInputSchema>;
export type AcpAuthListResult = z.infer<typeof AcpAuthListResultSchema>;
export type AcpAuthSyncResult = z.infer<typeof AcpAuthSyncResultSchema>;

export interface AcpProviderAuthFile {
  version: 1;
  providerId: string;
  method: Exclude<AcpAuthMethod, "external_cli">;
  credentialId: string;
  updatedAt: string;
  auth: {
    type: Exclude<AcpAuthMethod, "external_cli">;
    secret: string;
  };
  env?: Record<string, string>;
  metadata?: Record<string, string>;
}
