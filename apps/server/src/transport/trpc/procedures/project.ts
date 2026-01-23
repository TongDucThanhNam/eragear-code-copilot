import { z } from "zod";
import { ProjectService } from "../../../modules/project/application";
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
  listProjects: publicProcedure.query(({ ctx }) => {
    const service = new ProjectService(ctx.container.getProjects());
    return service.listProjects();
  }),

  createProject: publicProcedure
    .input(ProjectInputSchema)
    .mutation(({ input, ctx }) => {
      const service = new ProjectService(ctx.container.getProjects());
      return service.createProject(input);
    }),

  updateProject: publicProcedure
    .input(ProjectUpdateSchema)
    .mutation(({ input, ctx }) => {
      const service = new ProjectService(ctx.container.getProjects());
      return service.updateProject(input);
    }),

  deleteProject: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) => {
      const service = new ProjectService(ctx.container.getProjects());
      return service.deleteProject(input.id);
    }),

  setActiveProject: publicProcedure
    .input(z.object({ id: z.string().nullable() }))
    .mutation(({ input, ctx }) => {
      const service = new ProjectService(ctx.container.getProjects());
      return service.setActiveProject(input.id);
    }),
});
