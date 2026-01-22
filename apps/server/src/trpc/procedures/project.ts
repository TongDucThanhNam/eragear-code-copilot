import { z } from "zod";
import { getSettings } from "../../config/settings";
import {
  createProject,
  deleteProject,
  listProjects,
  setActiveProject,
  updateProject,
} from "../../projects/storage";
import { publicProcedure, router } from "../base";

const ProjectInputSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  description: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  favorite: z.boolean().optional(),
});

const ProjectUpdateSchema = ProjectInputSchema.partial().extend({
  id: z.string(),
});

export const projectRouter = router({
  listProjects: publicProcedure.query(() => {
    console.log("[tRPC] listProjects called");
    const result = listProjects();
    console.log("[tRPC] listProjects result:", JSON.stringify(result, null, 2));
    return result;
  }),

  createProject: publicProcedure
    .input(ProjectInputSchema)
    .mutation(({ input }) => {
      const { projectRoots } = getSettings();
      return createProject(input, projectRoots);
    }),

  updateProject: publicProcedure
    .input(ProjectUpdateSchema)
    .mutation(({ input }) => {
      const { projectRoots } = getSettings();
      return updateProject(input, projectRoots);
    }),

  deleteProject: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      deleteProject(input.id);
      return { ok: true };
    }),

  setActiveProject: publicProcedure
    .input(z.object({ id: z.string().nullable() }))
    .mutation(({ input }) => {
      return setActiveProject(input.id);
    }),
});
