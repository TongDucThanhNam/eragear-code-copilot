import { z } from "zod";

const ProjectInputSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  description: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  favorite: z.boolean().optional(),
});

export const CreateProjectInputSchema = ProjectInputSchema;
export const UpdateProjectInputSchema = ProjectInputSchema.partial().extend({
  id: z.string(),
});
export const DeleteProjectInputSchema = z.object({
  id: z.string(),
});
export const SetActiveProjectInputSchema = z.object({
  id: z.string().nullable(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;
export type DeleteProjectInput = z.infer<typeof DeleteProjectInputSchema>;
export type SetActiveProjectInput = z.infer<typeof SetActiveProjectInputSchema>;
