import { z } from "zod";

export const SkillsProjectInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
  })
  .strict()
  .optional();

export const ManageProjectSkillInputSchema = z
  .object({
    projectId: z.string().trim().min(1),
    skillId: z.string().trim().min(1),
  })
  .strict();

export const SkillInstallationStatusSchema = z.enum([
  "available",
  "installed",
  "conflict",
  "missing-source",
]);

export const SkillDescriptorSchema = z
  .object({
    id: z.string().min(1),
    folderName: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    sourcePath: z.string().min(1),
    installedPath: z.string().optional(),
    status: SkillInstallationStatusSchema,
    tags: z.array(z.string()),
    diagnostics: z.array(z.string()),
  })
  .strict();

export const SkillsCatalogSnapshotSchema = z
  .object({
    libraryPath: z.string().min(1),
    libraryExists: z.boolean(),
    projectId: z.string().nullable(),
    projectPath: z.string().nullable(),
    skills: z.array(SkillDescriptorSchema),
    diagnostics: z.array(z.string()),
  })
  .strict();

export const SkillsListResultSchema = SkillsCatalogSnapshotSchema.extend({
  installedCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
}).strict();

export type SkillsProjectInput = z.infer<typeof SkillsProjectInputSchema>;
export type ManageProjectSkillInput = z.infer<
  typeof ManageProjectSkillInputSchema
>;
export type SkillInstallationStatus = z.infer<
  typeof SkillInstallationStatusSchema
>;
export type SkillDescriptor = z.infer<typeof SkillDescriptorSchema>;
export type SkillsCatalogSnapshot = z.infer<typeof SkillsCatalogSnapshotSchema>;
export type SkillsListResult = z.infer<typeof SkillsListResultSchema>;
