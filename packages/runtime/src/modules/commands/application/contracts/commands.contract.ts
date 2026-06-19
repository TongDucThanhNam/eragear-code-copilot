import { z } from "zod";

export const SlashCommandsProjectInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
  })
  .strict()
  .optional();

export const UpsertSlashCommandInputSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(240).optional(),
    prompt: z.string().trim().min(1).max(20_000),
    argumentHint: z.string().trim().max(160).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const ToggleSlashCommandInputSchema = z
  .object({
    id: z.string().trim().min(1),
    enabled: z.boolean(),
  })
  .strict();

export const DeleteSlashCommandInputSchema = z
  .object({
    id: z.string().trim().min(1),
  })
  .strict();

export const SlashCommandDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  prompt: z.string(),
  sourcePath: z.string().min(1),
  enabled: z.boolean(),
  argumentHint: z.string().optional(),
  scope: z.string().min(1),
  storage: z.enum(["custom", "filesystem-discovery"]),
  tags: z.array(z.string()),
  diagnostics: z.array(z.string()),
  createdAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
});

export const CustomSlashCommandRecordSchema =
  SlashCommandDescriptorSchema.extend({
    userId: z.string().min(1),
    scope: z.literal("user"),
    storage: z.literal("custom"),
  });

export const SlashCommandsListResultSchema = z
  .object({
    commands: z.array(SlashCommandDescriptorSchema),
    enabledCount: z.number().int().nonnegative(),
    customCount: z.number().int().nonnegative(),
    discoveredCount: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative(),
  })
  .strict();

export type SlashCommandsProjectInput = z.infer<
  typeof SlashCommandsProjectInputSchema
>;
export type UpsertSlashCommandInput = z.infer<
  typeof UpsertSlashCommandInputSchema
>;
export type ToggleSlashCommandInput = z.infer<
  typeof ToggleSlashCommandInputSchema
>;
export type DeleteSlashCommandInput = z.infer<
  typeof DeleteSlashCommandInputSchema
>;
export type SlashCommandDescriptor = z.infer<
  typeof SlashCommandDescriptorSchema
>;
export type CustomSlashCommandRecord = z.infer<
  typeof CustomSlashCommandRecordSchema
>;
export type SlashCommandsListResult = z.infer<
  typeof SlashCommandsListResultSchema
>;
