import { z } from "zod";

export const PromptEnhancementModeSchema = z.enum([
  "execution",
  "planning",
  "concise",
]);

export const PromptEnhancementSettingsSchema = z
  .object({
    enabled: z.boolean(),
    includeProjectContext: z.boolean(),
    includeDate: z.boolean(),
    instructionMode: PromptEnhancementModeSchema,
    customInstruction: z.string().max(4000),
  })
  .strict();

export const UpdatePromptEnhancementSettingsInputSchema =
  PromptEnhancementSettingsSchema.partial().strict();

export const PromptEnhancementSettingsResultSchema = z
  .object({
    settings: PromptEnhancementSettingsSchema,
  })
  .strict();

export type PromptEnhancementMode = z.infer<typeof PromptEnhancementModeSchema>;
export type PromptEnhancementSettings = z.infer<
  typeof PromptEnhancementSettingsSchema
>;
export type UpdatePromptEnhancementSettingsInput = z.infer<
  typeof UpdatePromptEnhancementSettingsInputSchema
>;
export type PromptEnhancementSettingsResult = z.infer<
  typeof PromptEnhancementSettingsResultSchema
>;

export interface PromptEnhancementRequest {
  userId: string;
  chatId: string;
  text: string;
  source?: "client" | "supervisor";
  projectRoot?: string;
  projectId?: string;
}

export interface PromptEnhancementResult {
  text: string;
  applied: boolean;
  settings: PromptEnhancementSettings;
  sections: string[];
}
