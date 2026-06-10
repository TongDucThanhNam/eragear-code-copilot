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
    env: StringRecordSchema,
    headers: StringRecordSchema,
  })
  .strict();

const ToggleMcpServerInputSchema = z
  .object({
    projectId: z.string().optional(),
    id: z.string().trim().min(1),
    enabled: z.boolean(),
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
});
