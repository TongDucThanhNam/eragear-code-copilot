/**
 * Settings tRPC Router
 *
 * Mirrors the settings HTTP routes used by the dashboard so Electron IPC can
 * manage the same local runtime allowlists without opening the server HTTP UI.
 *
 * @module transport/trpc/routers/settings
 */

import { z } from "zod";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

const CommandPolicySchema = z
  .object({
    command: z.string().trim().min(1),
    allowAnyArgs: z.boolean().optional(),
    allowedArgs: z.array(z.string()).optional(),
    allowedArgPatterns: z.array(z.string()).optional(),
  })
  .strict();

const BootCommonSettingsSchema = z
  .object({
    wsAuthTimeoutMs: z.number().int().optional(),
    wsSessionRevalidateIntervalMs: z.number().int().optional(),
    wsHeartbeatIntervalMs: z.number().int().optional(),
    wsMaxPayloadBytes: z.number().int().optional(),
    logFileEnabled: z.boolean().optional(),
    logRetentionDays: z.number().int().optional(),
    acpEnableFsWrite: z.boolean().optional(),
    acpEnableTerminal: z.boolean().optional(),
    storageMaxDbSizeMb: z.number().int().optional(),
    authAllowSignup: z.boolean().optional(),
  })
  .strict();

const UpdateBootAllowlistsInputSchema = z
  .object({
    allowedAgentCommandPolicies: z.array(CommandPolicySchema).optional(),
    allowedTerminalCommandPolicies: z.array(CommandPolicySchema).optional(),
    allowedEnvKeys: z.array(z.string().trim().min(1)).optional(),
    commonSettings: BootCommonSettingsSchema.optional(),
  })
  .strict();

const UpdateCapabilityStateInputSchema = z
  .object({
    projectId: z.string().optional(),
    capabilityId: z.string().trim().min(1),
    enabled: z.boolean(),
  })
  .strict();

const McpTransportSchema = z.enum(["stdio", "sse", "streamable-http"]);

const StringRecordSchema = z.record(z.string(), z.string()).optional();

const McpRemoteControlsSchema = z
  .object({
    requestTimeoutMs: z.number().int().min(1000).max(15000).optional(),
    reconnectAttempts: z.number().int().min(0).max(3).optional(),
    notificationWatchMs: z.number().int().min(250).max(5000).optional(),
  })
  .strict();

const UpsertMcpServerInputSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().optional(),
    name: z.string().trim().min(1),
    transport: McpTransportSchema,
    enabled: z.boolean().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    url: z.string().optional(),
    messageEndpoint: z.string().optional(),
    env: StringRecordSchema,
    headers: StringRecordSchema,
    headerEnv: StringRecordSchema,
    remoteControls: McpRemoteControlsSchema.optional(),
  })
  .strict();

const ToggleMcpServerInputSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().trim().min(1),
    enabled: z.boolean(),
  })
  .strict();

const TrustMcpServerInputSchema = z
  .object({
    projectId: z.string().optional(),
    serverId: z.string().trim().min(1),
    fingerprint: z.string().trim().min(1),
  })
  .strict();

const ProbeMcpServerInputSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().trim().min(1),
  })
  .strict();

const InvokeMcpToolInputSchema = z
  .object({
    projectId: z.string().optional(),
    serverId: z.string().trim().min(1),
    toolName: z.string().trim().min(1),
    arguments: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const ReadMcpResourceInputSchema = z
  .object({
    projectId: z.string().optional(),
    serverId: z.string().trim().min(1),
    uri: z.string().trim().min(1),
  })
  .strict();

const WatchMcpNotificationsInputSchema = z
  .object({
    projectId: z.string().optional(),
    serverId: z.string().trim().min(1),
    durationMs: z.number().int().min(250).max(5000).optional(),
  })
  .strict();

const ConfigureMcpRemoteControlsInputSchema = z
  .object({
    projectId: z.string().optional(),
    serverId: z.string().trim().min(1),
    fingerprint: z.string().trim().min(1),
    requestTimeoutMs: z.number().int().min(1000).max(15000).optional(),
    reconnectAttempts: z.number().int().min(0).max(3).optional(),
    notificationWatchMs: z.number().int().min(250).max(5000).optional(),
  })
  .strict();

const TestProviderInputSchema = z
  .object({
    projectId: z.string().optional(),
    providerId: z.string().trim().min(1),
  })
  .strict();

const SelectProviderModelInputSchema = z
  .object({
    projectId: z.string().optional(),
    providerId: z.string().trim().min(1),
    modelId: z.string().trim().min(1),
  })
  .strict();

const ClearProviderModelInputSchema = z
  .object({
    projectId: z.string().optional(),
  })
  .strict()
  .optional();

const CreateCheckpointInputSchema = z
  .object({
    projectId: z.string().optional(),
    name: z.string().trim().min(1).optional(),
  })
  .strict()
  .optional();

const PreviewCheckpointInputSchema = z
  .object({
    projectId: z.string().optional(),
    checkpointId: z.string().trim().min(1),
  })
  .strict();

const RestoreCheckpointInputSchema = z
  .object({
    projectId: z.string().optional(),
    checkpointId: z.string().trim().min(1),
    confirmation: z.string().trim().min(1),
  })
  .strict();

const RestoreCheckpointFilesInputSchema = RestoreCheckpointInputSchema.extend({
  files: z.array(z.string().trim().min(1)).min(1).max(24),
}).strict();

const ShelveCheckpointConflictsInputSchema = RestoreCheckpointInputSchema.extend({
  files: z.array(z.string().trim().min(1)).min(1).max(24),
}).strict();

const ResolveCheckpointTrackedConflictsInputSchema =
  RestoreCheckpointInputSchema.extend({
    files: z.array(z.string().trim().min(1)).min(1).max(24),
  }).strict();

const ResolveCheckpointTrackedConflictChoiceInputSchema =
  RestoreCheckpointInputSchema.extend({
    files: z.array(z.string().trim().min(1)).min(1).max(24),
    resolution: z.enum(["restore", "current"]),
  }).strict();

const RestoreCheckpointHunksInputSchema = RestoreCheckpointInputSchema.extend({
  hunks: z
    .array(
      z
        .object({
          file: z.string().trim().min(1),
          hunkIndex: z.number().int().nonnegative(),
        })
        .strict()
    )
    .min(1)
    .max(24),
}).strict();

const ResolveCheckpointTrackedConflictHunksInputSchema =
  RestoreCheckpointHunksInputSchema;

const RefreshProjectIndexInputSchema = z
  .object({
    projectId: z.string().optional(),
  })
  .strict()
  .optional();

const SearchProjectIndexInputSchema = z
  .object({
    projectId: z.string().optional(),
    query: z.string().trim().min(1),
    limit: z.number().int().positive().max(32).optional(),
  })
  .strict();

const ProjectMemoryRetrievalModeSchema = z.enum(["full", "semantic"]);

const BuildProjectMemoryContextInputSchema = z
  .object({
    projectId: z.string().optional(),
    query: z.string().trim().optional(),
    presetId: z.string().trim().min(1).optional(),
    retrievalMode: ProjectMemoryRetrievalModeSchema.optional(),
    sourceIds: z.array(z.string().trim().min(1)).max(8).optional(),
    sourcePaths: z.array(z.string().trim().min(1)).max(8).optional(),
    maxBytes: z.number().int().positive().max(24_000).optional(),
    maxChunks: z.number().int().positive().max(8).optional(),
  })
  .strict();

const UpsertProjectMemoryPresetInputSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(80),
    sourcePaths: z.array(z.string().trim().min(1)).min(1).max(8),
    defaultQuery: z.string().trim().max(500).optional(),
    retrievalMode: ProjectMemoryRetrievalModeSchema.optional(),
    maxBytes: z.number().int().positive().max(24_000).optional(),
    maxChunks: z.number().int().positive().max(8).optional(),
  })
  .strict();

const DeleteProjectMemoryPresetInputSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().trim().min(1),
  })
  .strict();

const ExportAcpActivityInputSchema = z
  .object({
    projectId: z.string().optional(),
    chatId: z.string().trim().min(1).optional(),
    limit: z.number().int().positive().max(500).optional(),
  })
  .strict()
  .optional();

const RetryAcpActivityStreamInputSchema = z
  .object({
    projectId: z.string().optional(),
  })
  .strict()
  .optional();

const ReplayAcpActivityInputSchema = z
  .object({
    projectId: z.string().optional(),
    chatId: z.string().trim().min(1).optional(),
    correlationKey: z.string().trim().min(1).optional(),
    kind: z.string().trim().min(1).optional(),
    limit: z.number().int().positive().max(500).optional(),
  })
  .strict()
  .optional();

const SaveAcpReplayPresetInputSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(80),
    chatId: z.string().trim().min(1).optional(),
    correlationKey: z.string().trim().min(1).optional(),
    kind: z.string().trim().min(1).optional(),
    limit: z.number().int().positive().max(500).optional(),
  })
  .strict();

const DeleteAcpReplayPresetInputSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().trim().min(1),
  })
  .strict();

const AuditReviewStateSchema = z.enum(["all", "reviewed", "open"]);
const AuditRunStatusSchema = z.enum(["success", "failed", "timeout", "disabled"]);
const ExecutionPolicyPresetSchema = z.enum(["standard", "restricted", "blocked"]);
const HookLifecycleFailureModeSchema = z.enum(["continue", "stop-on-failure"]);

const UpsertHookInputSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().optional(),
    name: z.string().trim().min(1),
    event: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    policyPreset: ExecutionPolicyPresetSchema.optional(),
    envKeys: z.array(z.string().trim().min(1)).optional(),
    command: z.string().trim().min(1),
    args: z.array(z.string()).optional(),
    timeoutMs: z.number().int().positive().optional(),
    workingDirectory: z.string().optional(),
  })
  .strict();

const ToggleHookInputSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().trim().min(1),
    enabled: z.boolean(),
  })
  .strict();

const UpdateHookLifecyclePolicyInputSchema = z
  .object({
    projectId: z.string().optional(),
    enabled: z.boolean().optional(),
    disabledEvents: z.array(z.string().trim().min(1)).optional(),
    failureMode: HookLifecycleFailureModeSchema.optional(),
  })
  .strict();

const UpdateAutomationSchedulingPolicyInputSchema = z
  .object({
    projectId: z.string().optional(),
    enabled: z.boolean().optional(),
    maxConcurrentRuns: z.number().int().positive().max(4).optional(),
    cooldownMs: z.number().int().min(0).max(600000).optional(),
  })
  .strict();

const TrustHookInputSchema = z
  .object({
    projectId: z.string().optional(),
    hookId: z.string().trim().min(1),
    fingerprint: z.string().trim().startsWith("sha256:"),
  })
  .strict();

const ApproveHookRunInputSchema = z
  .object({
    projectId: z.string().optional(),
    hookId: z.string().trim().min(1),
    operationFingerprint: z.string().trim().startsWith("sha256:"),
  })
  .strict();

const RunHookInputSchema = z
  .object({
    projectId: z.string().optional(),
    hookId: z.string().trim().min(1),
    confirmation: z.string().trim().min(1),
    operationApprovalId: z.string().trim().min(1),
  })
  .strict();

const RunHookBatchInputSchema = z
  .object({
    projectId: z.string().optional(),
    hookIds: z.array(z.string().trim().min(1)).min(1).max(8),
    operationFingerprints: z.record(
      z.string().trim().min(1),
      z.string().trim().startsWith("sha256:")
    ),
    confirmation: z.string().trim().min(1),
    failureMode: HookLifecycleFailureModeSchema.optional(),
  })
  .strict();

const ReviewHookRunInputSchema = z
  .object({
    projectId: z.string().optional(),
    runId: z.string().trim().min(1),
    reviewed: z.boolean(),
  })
  .strict();

const ExportHookRunsInputSchema = z
  .object({
    projectId: z.string().optional(),
    reviewState: AuditReviewStateSchema.optional(),
    status: AuditRunStatusSchema.optional(),
    limit: z.number().int().positive().max(200).optional(),
  })
  .strict()
  .optional();

const UpsertPluginInputSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().optional(),
    name: z.string().trim().min(1),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
    policyPreset: ExecutionPolicyPresetSchema.optional(),
    scopes: z.array(z.enum(["process", "project-root", "env"])).optional(),
    dependencyIds: z.array(z.string().trim().min(1)).optional(),
    envKeys: z.array(z.string().trim().min(1)).optional(),
    command: z.string().trim().min(1),
    args: z.array(z.string()).optional(),
    timeoutMs: z.number().int().positive().optional(),
    workingDirectory: z.string().optional(),
  })
  .strict();

const InstallPluginPackageInputSchema = z
  .object({
    projectId: z.string().optional(),
    manifestPath: z.string().trim().min(1).optional(),
    registryUrl: z.string().trim().url().optional(),
    packageId: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const localMode = Boolean(value.manifestPath);
    const registryMode = Boolean(value.registryUrl || value.packageId);
    if (localMode && registryMode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either manifestPath or registryUrl/packageId, not both.",
        path: ["manifestPath"],
      });
    }
    if (!localMode && (!value.registryUrl || !value.packageId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide manifestPath or both registryUrl and packageId.",
        path: ["registryUrl"],
      });
    }
  });

const RevalidatePluginPackageInputSchema = z
  .object({
    projectId: z.string().optional(),
    pluginId: z.string().trim().min(1),
  })
  .strict();

const UpsertPluginRegistryInputSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().optional(),
    name: z.string().trim().min(1),
    url: z.string().trim().url(),
    enabled: z.boolean().optional(),
  })
  .strict();

const TrustPluginRegistryInputSchema = z
  .object({
    projectId: z.string().optional(),
    registryId: z.string().trim().min(1),
    fingerprint: z.string().trim().startsWith("sha256:"),
  })
  .strict();

const RevokePluginRegistryTrustInputSchema = z
  .object({
    projectId: z.string().optional(),
    registryId: z.string().trim().min(1),
  })
  .strict();

const RevokePluginRegistrySignerInputSchema = z
  .object({
    projectId: z.string().optional(),
    registryId: z.string().trim().min(1),
    publicKeyFingerprint: z.string().trim().startsWith("sha256:"),
    reason: z.string().trim().max(240).optional(),
  })
  .strict();

const RestorePluginRegistrySignerInputSchema = z
  .object({
    projectId: z.string().optional(),
    registryId: z.string().trim().min(1),
    publicKeyFingerprint: z.string().trim().startsWith("sha256:"),
  })
  .strict();

const RefreshPluginRegistryInputSchema = z
  .object({
    projectId: z.string().optional(),
    registryId: z.string().trim().min(1),
  })
  .strict();

const InstallPluginRegistryPackageInputSchema = z
  .object({
    projectId: z.string().optional(),
    registryId: z.string().trim().min(1),
    packageId: z.string().trim().min(1),
  })
  .strict();

const TogglePluginInputSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().trim().min(1),
    enabled: z.boolean(),
  })
  .strict();

const TrustPluginInputSchema = z
  .object({
    projectId: z.string().optional(),
    pluginId: z.string().trim().min(1),
    fingerprint: z.string().trim().startsWith("sha256:"),
  })
  .strict();

const UpdatePluginPermissionGrantInputSchema = z
  .object({
    projectId: z.string().optional(),
    pluginId: z.string().trim().min(1),
    permissionFingerprint: z.string().trim().startsWith("sha256:"),
    granted: z.boolean(),
  })
  .strict();

const ApprovePluginRunInputSchema = z
  .object({
    projectId: z.string().optional(),
    pluginId: z.string().trim().min(1),
    operationFingerprint: z.string().trim().startsWith("sha256:"),
  })
  .strict();

const RunPluginInputSchema = z
  .object({
    projectId: z.string().optional(),
    pluginId: z.string().trim().min(1),
    confirmation: z.string().trim().min(1),
    operationApprovalId: z.string().trim().min(1),
  })
  .strict();

const RunPluginBatchInputSchema = z
  .object({
    projectId: z.string().optional(),
    pluginIds: z.array(z.string().trim().min(1)).min(1).max(8),
    operationFingerprints: z.record(
      z.string().trim().min(1),
      z.string().trim().startsWith("sha256:")
    ),
    confirmation: z.string().trim().min(1),
    failureMode: z.enum(["continue", "stop-on-failure"]).optional(),
  })
  .strict();

const UpsertPluginBatchPresetInputSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(80),
    pluginIds: z.array(z.string().trim().min(1)).min(1).max(8),
    failureMode: z.enum(["continue", "stop-on-failure"]).optional(),
  })
  .strict();

const UpsertPluginBatchScheduleInputSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(120),
    presetId: z.string().trim().min(1),
    enabled: z.boolean().optional(),
    intervalMs: z.number().int().min(1000).max(86400000),
    nextRunAt: z.string().datetime().optional(),
    operationFingerprints: z.record(
      z.string().trim().min(1),
      z.string().trim().startsWith("sha256:")
    ),
  })
  .strict();

const DeletePluginBatchScheduleInputSchema = z
  .object({
    projectId: z.string().optional(),
    scheduleId: z.string().trim().min(1),
  })
  .strict();

const RunDuePluginBatchSchedulesInputSchema = z
  .object({
    projectId: z.string().optional(),
    scheduleIds: z.array(z.string().trim().min(1)).optional(),
    now: z.string().datetime().optional(),
  })
  .strict()
  .optional();

const DeletePluginBatchPresetInputSchema = z
  .object({
    projectId: z.string().optional(),
    presetId: z.string().trim().min(1),
  })
  .strict();

const RunPluginBatchPresetInputSchema = z
  .object({
    projectId: z.string().optional(),
    presetId: z.string().trim().min(1),
    operationFingerprints: z.record(
      z.string().trim().min(1),
      z.string().trim().startsWith("sha256:")
    ),
    confirmation: z.string().trim().min(1),
  })
  .strict();

const ReviewPluginRunInputSchema = z
  .object({
    projectId: z.string().optional(),
    runId: z.string().trim().min(1),
    reviewed: z.boolean(),
  })
  .strict();

const ExportPluginRunsInputSchema = z
  .object({
    projectId: z.string().optional(),
    reviewState: AuditReviewStateSchema.optional(),
    status: AuditRunStatusSchema.optional(),
    limit: z.number().int().positive().max(200).optional(),
  })
  .strict()
  .optional();

export const settingsRouter = router({
  /** Get persisted UI/app settings */
  get: protectedProcedure.query(async ({ ctx }) => {
    const service = ctx.useCases.settings.get;
    return await service.execute();
  }),

  /** Get boot/runtime allowlists */
  getBootAllowlists: protectedProcedure.query(async ({ ctx }) => {
    const service = ctx.useCases.settings.manageBootAllowlists;
    return await service.get();
  }),

  /** Update boot/runtime allowlists and hot-apply spawn policy when possible */
  updateBootAllowlists: protectedProcedure
    .input(UpdateBootAllowlistsInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.manageBootAllowlists;
      return await service.update(input);
    }),

  /** Get the local Electron ADE control-center read model. */
  getLocalAdeSnapshot: protectedProcedure.query(async ({ ctx }) => {
    const service = ctx.useCases.settings.localAde;
    return await service.snapshot(getRequiredUserId(ctx));
  }),

  /** Persist project-local capability enablement. */
  updateCapabilityState: protectedProcedure
    .input(UpdateCapabilityStateInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.updateCapabilityState(getRequiredUserId(ctx), input);
    }),

  /** Add or update a project-local MCP server descriptor. */
  upsertMcpServer: protectedProcedure
    .input(UpsertMcpServerInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.upsertMcpServer(getRequiredUserId(ctx), input);
    }),

  /** Toggle a project-local MCP server descriptor. */
  toggleMcpServer: protectedProcedure
    .input(ToggleMcpServerInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.toggleMcpServer(getRequiredUserId(ctx), input);
    }),

  /** Trust the current MCP invocation fingerprint before manual tool/resource calls. */
  trustMcpServer: protectedProcedure
    .input(TrustMcpServerInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.trustMcpServer(getRequiredUserId(ctx), input);
    }),

  /** Probe one project-local MCP server and persist a redacted probe history run. */
  probeMcpServer: protectedProcedure
    .input(ProbeMcpServerInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.probeMcpServer(getRequiredUserId(ctx), input);
    }),

  /** Invoke a discovered MCP tool through the configured server transport. */
  invokeMcpTool: protectedProcedure
    .input(InvokeMcpToolInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.invokeMcpTool(getRequiredUserId(ctx), input);
    }),

  /** Read a discovered MCP resource through the configured server transport. */
  readMcpResource: protectedProcedure
    .input(ReadMcpResourceInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.readMcpResource(getRequiredUserId(ctx), input);
    }),

  /** Watch a trusted SSE MCP notification stream briefly and persist reconnect diagnostics. */
  watchMcpNotifications: protectedProcedure
    .input(WatchMcpNotificationsInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.watchMcpNotifications(getRequiredUserId(ctx), input);
    }),

  /** Configure reviewed remote MCP operational controls. */
  configureMcpRemoteControls: protectedProcedure
    .input(ConfigureMcpRemoteControlsInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.configureMcpRemoteControls(
        getRequiredUserId(ctx),
        input
      );
    }),

  /** Probe a local provider/agent command and persist redacted health metadata. */
  testProvider: protectedProcedure
    .input(TestProviderInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.testProvider(getRequiredUserId(ctx), input);
    }),

  /** Select a readiness-probed provider model as the default for new sessions. */
  selectProviderModel: protectedProcedure
    .input(SelectProviderModelInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.selectProviderModel(getRequiredUserId(ctx), input);
    }),

  /** Clear the configured default provider model for new sessions. */
  clearProviderModel: protectedProcedure
    .input(ClearProviderModelInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.clearProviderModel(getRequiredUserId(ctx), input ?? {});
    }),

  /** Capture a project-local Git checkpoint patch for review/change trust. */
  createCheckpoint: protectedProcedure
    .input(CreateCheckpointInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.createCheckpoint(getRequiredUserId(ctx), input ?? {});
    }),

  /** Read a checkpoint patch preview without applying it. */
  previewCheckpoint: protectedProcedure
    .input(PreviewCheckpointInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.previewCheckpoint(getRequiredUserId(ctx), input);
    }),

  /** Restore a checkpoint through guarded reverse-patch checks. */
  restoreCheckpoint: protectedProcedure
    .input(RestoreCheckpointInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.restoreCheckpoint(getRequiredUserId(ctx), input);
    }),

  /** Restore selected files from a checkpoint through guarded patch filtering. */
  restoreCheckpointFiles: protectedProcedure
    .input(RestoreCheckpointFilesInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.restoreCheckpointFiles(getRequiredUserId(ctx), input);
    }),

  /** Move unexpected untracked checkpoint restore blockers into a local shelf. */
  shelveCheckpointConflicts: protectedProcedure
    .input(ShelveCheckpointConflictsInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.shelveCheckpointConflicts(getRequiredUserId(ctx), input);
    }),

  /** Reset selected tracked patch conflicts after creating a safety checkpoint. */
  resolveCheckpointTrackedConflicts: protectedProcedure
    .input(ResolveCheckpointTrackedConflictsInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.resolveCheckpointTrackedConflicts(
        getRequiredUserId(ctx),
        input
      );
    }),

  /** Resolve tracked patch conflicts with an explicit restore/current choice. */
  resolveCheckpointTrackedConflictChoice: protectedProcedure
    .input(ResolveCheckpointTrackedConflictChoiceInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.resolveCheckpointTrackedConflictChoice(
        getRequiredUserId(ctx),
        input
      );
    }),

  /** Resolve tracked checkpoint conflicts by restoring selected hunks and keeping the rest. */
  resolveCheckpointTrackedConflictHunks: protectedProcedure
    .input(ResolveCheckpointTrackedConflictHunksInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.resolveCheckpointTrackedConflictHunks(
        getRequiredUserId(ctx),
        input
      );
    }),

  /** Restore selected hunks from a checkpoint through guarded patch filtering. */
  restoreCheckpointHunks: protectedProcedure
    .input(RestoreCheckpointHunksInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.restoreCheckpointHunks(getRequiredUserId(ctx), input);
    }),

  /** Refresh the project metadata index used by the local ADE control surface. */
  refreshProjectIndex: protectedProcedure
    .input(RefreshProjectIndexInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.refreshProjectIndex(getRequiredUserId(ctx), input ?? {});
    }),

  /** Search the persisted project index and return a bounded agent-context prompt. */
  searchProjectIndex: protectedProcedure
    .input(SearchProjectIndexInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.searchProjectIndex(getRequiredUserId(ctx), input);
    }),

  /** Build a bounded redacted project-memory prompt for explicit or per-message chat context. */
  buildProjectMemoryContext: protectedProcedure
    .input(BuildProjectMemoryContextInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.buildProjectMemoryContext(getRequiredUserId(ctx), input);
    }),

  /** Save or update a project-local Project Memory preset. */
  upsertProjectMemoryPreset: protectedProcedure
    .input(UpsertProjectMemoryPresetInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.upsertProjectMemoryPreset(getRequiredUserId(ctx), input);
    }),

  /** Delete a project-local Project Memory preset. */
  deleteProjectMemoryPreset: protectedProcedure
    .input(DeleteProjectMemoryPresetInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.deleteProjectMemoryPreset(getRequiredUserId(ctx), input);
    }),

  /** Export a redacted ACP activity trace for local debugging. */
  exportAcpActivity: protectedProcedure
    .input(ExportAcpActivityInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.exportAcpActivity(getRequiredUserId(ctx), input ?? {});
    }),

  /** Retry the local ACP activity capture/diagnostics snapshot without replaying protocol calls. */
  retryAcpActivityStream: protectedProcedure
    .input(RetryAcpActivityStreamInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.retryAcpActivityStream(
        getRequiredUserId(ctx),
        input ?? {}
      );
    }),

  /** Build a redacted chronological ACP activity replay for local debugging. */
  replayAcpActivity: protectedProcedure
    .input(ReplayAcpActivityInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.replayAcpActivity(getRequiredUserId(ctx), input ?? {});
    }),

  /** Save a project-local ACP replay filter preset for repeated debugging. */
  saveAcpReplayPreset: protectedProcedure
    .input(SaveAcpReplayPresetInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.saveAcpReplayPreset(getRequiredUserId(ctx), input);
    }),

  /** Delete a project-local ACP replay filter preset. */
  deleteAcpReplayPreset: protectedProcedure
    .input(DeleteAcpReplayPresetInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.deleteAcpReplayPreset(getRequiredUserId(ctx), input);
    }),

  /** Add or update a project-local manual hook descriptor. */
  upsertHook: protectedProcedure
    .input(UpsertHookInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.upsertHook(getRequiredUserId(ctx), input);
    }),

  /** Toggle a project-local manual hook descriptor. */
  toggleHook: protectedProcedure
    .input(ToggleHookInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.toggleHook(getRequiredUserId(ctx), input);
    }),

  /** Update project-local lifecycle hook dispatch governance. */
  updateHookLifecyclePolicy: protectedProcedure
    .input(UpdateHookLifecyclePolicyInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.updateHookLifecyclePolicy(
        getRequiredUserId(ctx),
        input
      );
    }),

  /** Update project-local hook execution scheduling and parallel limits. */
  updateHookSchedulingPolicy: protectedProcedure
    .input(UpdateAutomationSchedulingPolicyInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.updateHookSchedulingPolicy(getRequiredUserId(ctx), input);
    }),

  /** Trust the current project-local hook command fingerprint before execution. */
  trustHook: protectedProcedure
    .input(TrustHookInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.trustHook(getRequiredUserId(ctx), input);
    }),

  /** Approve the current project-local hook manual-run operation before spawn. */
  approveHookRun: protectedProcedure
    .input(ApproveHookRunInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.approveHookRun(getRequiredUserId(ctx), input);
    }),

  /** Execute a project-local manual hook and persist the redacted run result. */
  runHook: protectedProcedure.input(RunHookInputSchema).mutation(async ({ input, ctx }) => {
    const service = ctx.useCases.settings.localAde;
    return await service.runHook(getRequiredUserId(ctx), input);
  }),

  /** Execute a guarded project-local hook batch queue and persist run summaries. */
  runHookBatch: protectedProcedure
    .input(RunHookBatchInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.runHookBatch(getRequiredUserId(ctx), input);
    }),

  /** Mark or reopen a persisted project-local hook run audit entry. */
  reviewHookRun: protectedProcedure
    .input(ReviewHookRunInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.reviewHookRun(getRequiredUserId(ctx), input);
    }),

  /** Export a redacted project-local hook run audit artifact. */
  exportHookRuns: protectedProcedure
    .input(ExportHookRunsInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.exportHookRuns(getRequiredUserId(ctx), input ?? {});
    }),

  /** Add or update a project-local plugin descriptor. */
  upsertPlugin: protectedProcedure
    .input(UpsertPluginInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.upsertPlugin(getRequiredUserId(ctx), input);
    }),

  /** Install a signed project-local plugin package after signature verification. */
  installPluginPackage: protectedProcedure
    .input(InstallPluginPackageInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.installPluginPackage(getRequiredUserId(ctx), input);
    }),

  /** Revalidate an installed signed plugin package against its manifest or registry pins. */
  revalidatePluginPackage: protectedProcedure
    .input(RevalidatePluginPackageInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.revalidatePluginPackage(
        getRequiredUserId(ctx),
        input
      );
    }),

  /** Add or update a saved signed plugin registry descriptor. */
  upsertPluginRegistry: protectedProcedure
    .input(UpsertPluginRegistryInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.upsertPluginRegistry(getRequiredUserId(ctx), input);
    }),

  /** Trust a saved plugin registry URL fingerprint before refresh/install. */
  trustPluginRegistry: protectedProcedure
    .input(TrustPluginRegistryInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.trustPluginRegistry(getRequiredUserId(ctx), input);
    }),

  /** Revoke a saved plugin registry URL trust approval. */
  revokePluginRegistryTrust: protectedProcedure
    .input(RevokePluginRegistryTrustInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.revokePluginRegistryTrust(
        getRequiredUserId(ctx),
        input
      );
    }),

  /** Revoke a plugin registry signer/public-key fingerprint. */
  revokePluginRegistrySigner: protectedProcedure
    .input(RevokePluginRegistrySignerInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.revokePluginRegistrySigner(
        getRequiredUserId(ctx),
        input
      );
    }),

  /** Restore a previously revoked plugin registry signer/public-key fingerprint. */
  restorePluginRegistrySigner: protectedProcedure
    .input(RestorePluginRegistrySignerInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.restorePluginRegistrySigner(
        getRequiredUserId(ctx),
        input
      );
    }),

  /** Refresh a trusted signed plugin registry and store pinned package metadata. */
  refreshPluginRegistry: protectedProcedure
    .input(RefreshPluginRegistryInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.refreshPluginRegistry(getRequiredUserId(ctx), input);
    }),

  /** Install a package from a trusted saved signed plugin registry. */
  installPluginRegistryPackage: protectedProcedure
    .input(InstallPluginRegistryPackageInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.installPluginRegistryPackage(
        getRequiredUserId(ctx),
        input
      );
    }),

  /** Toggle a project-local plugin descriptor. */
  togglePlugin: protectedProcedure
    .input(TogglePluginInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.togglePlugin(getRequiredUserId(ctx), input);
    }),

  /** Update project-local plugin execution scheduling and parallel limits. */
  updatePluginSchedulingPolicy: protectedProcedure
    .input(UpdateAutomationSchedulingPolicyInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.updatePluginSchedulingPolicy(
        getRequiredUserId(ctx),
        input
      );
    }),

  /** Trust the current project-local plugin command fingerprint before execution. */
  trustPlugin: protectedProcedure
    .input(TrustPluginInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.trustPlugin(getRequiredUserId(ctx), input);
    }),

  /** Grant or revoke the current project-local plugin permission fingerprint. */
  updatePluginPermissionGrant: protectedProcedure
    .input(UpdatePluginPermissionGrantInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.updatePluginPermissionGrant(
        getRequiredUserId(ctx),
        input
      );
    }),

  /** Approve the current project-local plugin manual-run operation once. */
  approvePluginRun: protectedProcedure
    .input(ApprovePluginRunInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.approvePluginRun(getRequiredUserId(ctx), input);
    }),

  /** Execute a project-local plugin and persist the redacted run result. */
  runPlugin: protectedProcedure
    .input(RunPluginInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.runPlugin(getRequiredUserId(ctx), input);
    }),

  /** Execute a confirmed project-local plugin batch queue and persist run audits. */
  runPluginBatch: protectedProcedure
    .input(RunPluginBatchInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.runPluginBatch(getRequiredUserId(ctx), input);
    }),

  /** Save or update a reusable project-local plugin batch preset. */
  upsertPluginBatchPreset: protectedProcedure
    .input(UpsertPluginBatchPresetInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.upsertPluginBatchPreset(getRequiredUserId(ctx), input);
    }),

  /** Delete a reusable project-local plugin batch preset. */
  deletePluginBatchPreset: protectedProcedure
    .input(DeletePluginBatchPresetInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.deletePluginBatchPreset(getRequiredUserId(ctx), input);
    }),

  /** Execute a saved project-local plugin batch preset through the batch runner. */
  runPluginBatchPreset: protectedProcedure
    .input(RunPluginBatchPresetInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.runPluginBatchPreset(getRequiredUserId(ctx), input);
    }),

  /** Save or update a persisted schedule for a plugin batch preset. */
  upsertPluginBatchSchedule: protectedProcedure
    .input(UpsertPluginBatchScheduleInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.upsertPluginBatchSchedule(
        getRequiredUserId(ctx),
        input
      );
    }),

  /** Delete a persisted plugin batch schedule. */
  deletePluginBatchSchedule: protectedProcedure
    .input(DeletePluginBatchScheduleInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.deletePluginBatchSchedule(
        getRequiredUserId(ctx),
        input
      );
    }),

  /** Execute due plugin batch schedules through the guarded batch runner. */
  runDuePluginBatchSchedules: protectedProcedure
    .input(RunDuePluginBatchSchedulesInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.runDuePluginBatchSchedules(
        getRequiredUserId(ctx),
        input ?? {}
      );
    }),

  /** Mark or reopen a persisted project-local plugin run audit entry. */
  reviewPluginRun: protectedProcedure
    .input(ReviewPluginRunInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.reviewPluginRun(getRequiredUserId(ctx), input);
    }),

  /** Export a redacted project-local plugin run audit artifact. */
  exportPluginRuns: protectedProcedure
    .input(ExportPluginRunsInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.exportPluginRuns(getRequiredUserId(ctx), input ?? {});
    }),
});
