/**
 * Project tRPC Router
 *
 * RPC endpoints for project management: listing, creating, updating, deleting,
 * and setting the active project. Projects represent code workspaces.
 *
 * @module transport/trpc/routers/project
 */

import {
  CreateProjectInputSchema,
  DeleteProjectInputSchema,
  SetActiveProjectInputSchema,
  UpdateProjectInputSchema,
} from "@/modules/project";
import { protectedProcedure, router } from "../base";

export const projectRouter = router({
  /** List all projects */
  listProjects: protectedProcedure.query(async ({ ctx }) => {
    const service = ctx.container.getProjectServices().project();
    return await service.listProjects();
  }),

  /** Create a new project */
  createProject: protectedProcedure
    .input(CreateProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.container.getProjectServices().project();
      return await service.createProject(input);
    }),

  /** Update an existing project */
  updateProject: protectedProcedure
    .input(UpdateProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.container.getProjectServices().project();
      return await service.updateProject(input);
    }),

  /** Delete a project */
  deleteProject: protectedProcedure
    .input(DeleteProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.container.getProjectServices().project();
      return await service.deleteProject(input.id);
    }),

  /** Set the active project (for UI state) */
  setActiveProject: protectedProcedure
    .input(SetActiveProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.container.getProjectServices().project();
      return await service.setActiveProject(input.id);
    }),
});
