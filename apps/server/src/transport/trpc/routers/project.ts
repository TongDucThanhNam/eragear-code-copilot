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
import { protectedProcedure, router } from "../base";

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
  listProjects: protectedProcedure.query(async ({ ctx }) => {
    const service = new ProjectService(
      ctx.container.getProjects(),
      ctx.container.getSessions(),
      ctx.container.getSessionRuntime()
    );
    return await service.listProjects();
  }),

  /** Create a new project */
  createProject: protectedProcedure
    .input(ProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = new ProjectService(
        ctx.container.getProjects(),
        ctx.container.getSessions(),
        ctx.container.getSessionRuntime()
      );
      return await service.createProject(input);
    }),

  /** Update an existing project */
  updateProject: protectedProcedure
    .input(ProjectUpdateSchema)
    .mutation(async ({ input, ctx }) => {
      const service = new ProjectService(
        ctx.container.getProjects(),
        ctx.container.getSessions(),
        ctx.container.getSessionRuntime()
      );
      return await service.updateProject(input);
    }),

  /** Delete a project */
  deleteProject: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const service = new ProjectService(
        ctx.container.getProjects(),
        ctx.container.getSessions(),
        ctx.container.getSessionRuntime()
      );
      return await service.deleteProject(input.id);
    }),

  /** Set the active project (for UI state) */
  setActiveProject: protectedProcedure
    .input(z.object({ id: z.string().nullable() }))
    .mutation(async ({ input, ctx }) => {
      const service = new ProjectService(
        ctx.container.getProjects(),
        ctx.container.getSessions(),
        ctx.container.getSessionRuntime()
      );
      return await service.setActiveProject(input.id);
    }),
});
