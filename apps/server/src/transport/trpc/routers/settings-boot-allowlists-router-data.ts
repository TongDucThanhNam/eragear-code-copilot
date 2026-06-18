import { z } from "zod";

export const CommandPolicyRequestSchema = z
  .object({
    command: z.string().trim().min(1),
    allowAnyArgs: z.boolean().optional(),
    allowedArgs: z.array(z.string()).optional(),
    allowedArgPatterns: z.array(z.string()).optional(),
  })
  .strict();

export const BootCommonSettingsRequestSchema = z
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

export const UpdateBootAllowlistsRequestSchema = z
  .object({
    allowedAgentCommandPolicies: z.array(CommandPolicyRequestSchema).optional(),
    allowedTerminalCommandPolicies: z
      .array(CommandPolicyRequestSchema)
      .optional(),
    allowedEnvKeys: z.array(z.string().trim().min(1)).optional(),
    commonSettings: BootCommonSettingsRequestSchema.optional(),
  })
  .strict();

export type UpdateBootAllowlistsRequest = z.infer<
  typeof UpdateBootAllowlistsRequestSchema
>;
