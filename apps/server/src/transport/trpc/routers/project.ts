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
    const service = ctx.container.getProjectServices().listProjects();
    return await service.execute(ctx.auth!.userId);
  }),

  /** Create a new project */
  createProject: protectedProcedure
    .input(CreateProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.container.getProjectServices().createProject();
      return await service.execute(ctx.auth!.userId, input);
    }),

  /** Update an existing project */
  updateProject: protectedProcedure
    .input(UpdateProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.container.getProjectServices().updateProject();
      return await service.execute(ctx.auth!.userId, input);
    }),

  /** Delete a project */
  deleteProject: protectedProcedure
    .input(DeleteProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.container.getProjectServices().deleteProject();
      return await service.execute(ctx.auth!.userId, input.id);
    }),

  /** Set the active project (for UI state) */
  setActiveProject: protectedProcedure
    .input(SetActiveProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.container.getProjectServices().setActiveProject();
      return await service.execute(ctx.auth!.userId, input.id);
    }),
});
