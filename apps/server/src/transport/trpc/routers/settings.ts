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

const TestProviderInputSchema = z
  .object({
    projectId: z.string().optional(),
    providerId: z.string().trim().min(1),
  })
  .strict();

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

const BuildProjectMemoryContextInputSchema = z
  .object({
    projectId: z.string().optional(),
    query: z.string().trim().min(1),
    sourceIds: z.array(z.string().trim().min(1)).max(8).optional(),
    sourcePaths: z.array(z.string().trim().min(1)).max(8).optional(),
    maxBytes: z.number().int().positive().max(24_000).optional(),
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

const ReplayAcpActivityInputSchema = z
  .object({
    projectId: z.string().optional(),
    chatId: z.string().trim().min(1).optional(),
    correlationKey: z.string().trim().min(1).optional(),
    limit: z.number().int().positive().max(500).optional(),
  })
  .strict()
  .optional();

const UpsertHookInputSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().optional(),
    name: z.string().trim().min(1),
    event: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
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

const TrustHookInputSchema = z
  .object({
    projectId: z.string().optional(),
    hookId: z.string().trim().min(1),
    fingerprint: z.string().trim().startsWith("sha256:"),
  })
  .strict();

const RunHookInputSchema = z
  .object({
    projectId: z.string().optional(),
    hookId: z.string().trim().min(1),
  })
  .strict();

const UpsertPluginInputSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().optional(),
    name: z.string().trim().min(1),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
    scopes: z.array(z.enum(["process", "project-root", "env"])).optional(),
    envKeys: z.array(z.string().trim().min(1)).optional(),
    command: z.string().trim().min(1),
    args: z.array(z.string()).optional(),
    timeoutMs: z.number().int().positive().optional(),
    workingDirectory: z.string().optional(),
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

const RunPluginInputSchema = z
  .object({
    projectId: z.string().optional(),
    pluginId: z.string().trim().min(1),
  })
  .strict();

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

  /** Probe a local provider/agent command and persist redacted health metadata. */
  testProvider: protectedProcedure
    .input(TestProviderInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.testProvider(getRequiredUserId(ctx), input);
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

  /** Export a redacted ACP activity trace for local debugging. */
  exportAcpActivity: protectedProcedure
    .input(ExportAcpActivityInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.exportAcpActivity(getRequiredUserId(ctx), input ?? {});
    }),

  /** Build a redacted chronological ACP activity replay for local debugging. */
  replayAcpActivity: protectedProcedure
    .input(ReplayAcpActivityInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.replayAcpActivity(getRequiredUserId(ctx), input ?? {});
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

  /** Trust the current project-local hook command fingerprint before execution. */
  trustHook: protectedProcedure
    .input(TrustHookInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.trustHook(getRequiredUserId(ctx), input);
    }),

  /** Execute a project-local manual hook and persist the redacted run result. */
  runHook: protectedProcedure.input(RunHookInputSchema).mutation(async ({ input, ctx }) => {
    const service = ctx.useCases.settings.localAde;
    return await service.runHook(getRequiredUserId(ctx), input);
  }),

  /** Add or update a project-local plugin descriptor. */
  upsertPlugin: protectedProcedure
    .input(UpsertPluginInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.upsertPlugin(getRequiredUserId(ctx), input);
    }),

  /** Toggle a project-local plugin descriptor. */
  togglePlugin: protectedProcedure
    .input(TogglePluginInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.togglePlugin(getRequiredUserId(ctx), input);
    }),

  /** Trust the current project-local plugin command fingerprint before execution. */
  trustPlugin: protectedProcedure
    .input(TrustPluginInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.trustPlugin(getRequiredUserId(ctx), input);
    }),

  /** Execute a project-local plugin and persist the redacted run result. */
  runPlugin: protectedProcedure
    .input(RunPluginInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.settings.localAde;
      return await service.runPlugin(getRequiredUserId(ctx), input);
    }),
});
