import { z } from "zod";

export const SkillsProjectInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
  })
  .strict()
  .optional();

export const SetSkillEnabledInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    skillId: z.string().trim().min(1),
    enabled: z.boolean(),
  })
  .strict();

export const SkillDescriptorSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    scope: z.string().min(1),
    enabled: z.boolean(),
    sourcePath: z.string().min(1),
    prompt: z.string(),
    tags: z.array(z.string()),
    diagnostics: z.array(z.string()),
  })
  .strict();

export const SkillsListResultSchema = z
  .object({
    skills: z.array(SkillDescriptorSchema),
    enabledCount: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative(),
  })
  .strict();

export type SkillsProjectInput = z.infer<typeof SkillsProjectInputSchema>;
export type SetSkillEnabledInput = z.infer<typeof SetSkillEnabledInputSchema>;
export type SkillDescriptor = z.infer<typeof SkillDescriptorSchema>;
export type SkillsListResult = z.infer<typeof SkillsListResultSchema>;
