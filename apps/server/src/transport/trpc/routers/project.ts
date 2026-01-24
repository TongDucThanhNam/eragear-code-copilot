/**
 * Project tRPC Router
 *
 * RPC endpoints for project management: listing, creating, updating, deleting,
 * and setting the active project. Projects represent code workspaces.
 *
 * @module transport/trpc/routers/project
 */

import { z } from "zod";
import { ProjectService } from "@/modules/project/application/project.service";
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
  /** List all projects */
  listProjects: publicProcedure.query(({ ctx }) => {
    const service = new ProjectService(ctx.container.getProjects());
    return service.listProjects();
  }),

  /** Create a new project */
  createProject: publicProcedure
    .input(ProjectInputSchema)
    .mutation(({ input, ctx }) => {
      const service = new ProjectService(ctx.container.getProjects());
      return service.createProject(input);
    }),

  /** Update an existing project */
  updateProject: publicProcedure
    .input(ProjectUpdateSchema)
    .mutation(({ input, ctx }) => {
      const service = new ProjectService(ctx.container.getProjects());
      return service.updateProject(input);
    }),

  /** Delete a project */
  deleteProject: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) => {
      const service = new ProjectService(ctx.container.getProjects());
      return service.deleteProject(input.id);
    }),

  /** Set the active project (for UI state) */
  setActiveProject: publicProcedure
    .input(z.object({ id: z.string().nullable() }))
    .mutation(({ input, ctx }) => {
      const service = new ProjectService(ctx.container.getProjects());
      return service.setActiveProject(input.id);
    }),
});
