import { z } from "zod";
import {
  AppConfigSchema,
  UiSettingsSchema,
} from "#runtime/shared/contracts/settings.contract";

const McpEnvSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const McpHeaderSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const McpStdioSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  env: z.array(McpEnvSchema).optional(),
});

const McpHttpSchema = z.object({
  type: z.literal("http"),
  name: z.string(),
  url: z.string(),
  headers: z.array(McpHeaderSchema),
});

const McpSseSchema = z.object({
  type: z.literal("sse"),
  name: z.string(),
  url: z.string(),
  headers: z.array(McpHeaderSchema),
});

export const SyncedSettingsSchema = z.object({
  ui: UiSettingsSchema,
  projectRoots: z.array(z.string()).min(1),
  mcpServers: z
    .array(z.union([McpStdioSchema, McpHttpSchema, McpSseSchema]))
    .optional(),
  app: AppConfigSchema,
});

export const SettingsSyncConflictSchema = z.object({
  detectedAt: z.number(),
  reason: z.enum(["both_changed", "first_sync_remote_exists"]),
  localHash: z.string(),
  remoteHash: z.string(),
  remoteRevision: z.string(),
  remoteUpdatedAt: z.number(),
});
export type SettingsSyncConflict = z.infer<typeof SettingsSyncConflictSchema>;

export const SettingsSyncStateSchema = z.object({
  userId: z.string(),
  enabled: z.boolean(),
  firstRunPromptHandled: z.boolean(),
  deviceId: z.string(),
  lastSyncAt: z.number().nullable(),
  lastPushAt: z.number().nullable(),
  lastPullAt: z.number().nullable(),
  lastSyncedSettingsHash: z.string().nullable(),
  lastRemoteRevision: z.string().nullable(),
  pendingConflict: SettingsSyncConflictSchema.nullable(),
});
export type SettingsSyncState = z.infer<typeof SettingsSyncStateSchema>;

export const SettingsSyncRemoteSnapshotSchema = z.object({
  version: z.literal(1),
  userId: z.string(),
  revision: z.string(),
  updatedAt: z.number(),
  deviceId: z.string(),
  settingsHash: z.string(),
  settings: SyncedSettingsSchema,
});
export type SettingsSyncRemoteSnapshot = z.infer<
  typeof SettingsSyncRemoteSnapshotSchema
>;

export const SettingsSyncStrategySchema = z.enum(["auto", "push", "pull"]);
export type SettingsSyncStrategy = z.infer<typeof SettingsSyncStrategySchema>;

export const SettingsSyncNowInputSchema = z
  .object({
    strategy: SettingsSyncStrategySchema.optional(),
  })
  .strict()
  .optional();
export type SettingsSyncNowInput = z.input<typeof SettingsSyncNowInputSchema>;

export const UpdateSettingsSyncConfigInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    firstRunPromptHandled: z.boolean().optional(),
  })
  .strict();
export type UpdateSettingsSyncConfigInput = z.infer<
  typeof UpdateSettingsSyncConfigInputSchema
>;

export const SettingsSyncRemoteStatusSchema = z.object({
  available: z.boolean(),
  revision: z.string().nullable(),
  updatedAt: z.number().nullable(),
  deviceId: z.string().nullable(),
  settingsHash: z.string().nullable(),
});
export type SettingsSyncRemoteStatus = z.infer<
  typeof SettingsSyncRemoteStatusSchema
>;

export const SettingsSyncStatusSchema = z.object({
  state: SettingsSyncStateSchema,
  remote: SettingsSyncRemoteStatusSchema,
  localSettingsHash: z.string(),
});
export type SettingsSyncStatus = z.infer<typeof SettingsSyncStatusSchema>;

export const SettingsSyncResultSchema = z.object({
  action: z.enum(["pushed", "pulled", "conflict", "noop"]),
  status: SettingsSyncStatusSchema,
});
export type SettingsSyncResult = z.infer<typeof SettingsSyncResultSchema>;
