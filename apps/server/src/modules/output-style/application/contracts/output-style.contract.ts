import { z } from "zod";

export const OutputStylePresetIdSchema = z.enum([
  "default",
  "concise",
  "explanatory",
  "review",
]);
export type OutputStylePresetId = z.infer<typeof OutputStylePresetIdSchema>;

export const OutputStylePresetSchema = z.object({
  id: OutputStylePresetIdSchema,
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
});
export type OutputStylePreset = z.infer<typeof OutputStylePresetSchema>;

export const OutputStyleSettingsSchema = z.object({
  enabled: z.boolean(),
  activePresetId: OutputStylePresetIdSchema,
  updatedAt: z.number(),
});
export type OutputStyleSettings = z.infer<typeof OutputStyleSettingsSchema>;

export const UpdateOutputStyleSettingsInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    activePresetId: OutputStylePresetIdSchema.optional(),
  })
  .strict();
export type UpdateOutputStyleSettingsInput = z.infer<
  typeof UpdateOutputStyleSettingsInputSchema
>;

export const OutputStyleSettingsResultSchema = z.object({
  settings: OutputStyleSettingsSchema,
  presets: z.array(OutputStylePresetSchema),
});
export type OutputStyleSettingsResult = z.infer<
  typeof OutputStyleSettingsResultSchema
>;

export interface OutputStylePromptPrefix {
  applied: boolean;
  presetId: OutputStylePresetId;
  text: string;
}
