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

function requireUserId(ctx: { auth?: { userId?: string } | null }): string {
  const userId = ctx.auth?.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }
  return userId;
}

export const projectRouter = router({
  /** List all projects */
  listProjects: protectedProcedure.query(async ({ ctx }) => {
    const service = ctx.projectServices.listProjects();
    return await service.execute(requireUserId(ctx));
  }),

  /** Create a new project */
  createProject: protectedProcedure
    .input(CreateProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.projectServices.createProject();
      return await service.execute(requireUserId(ctx), input);
    }),

  /** Update an existing project */
  updateProject: protectedProcedure
    .input(UpdateProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.projectServices.updateProject();
      return await service.execute(requireUserId(ctx), input);
    }),

  /** Delete a project */
  deleteProject: protectedProcedure
    .input(DeleteProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.projectServices.deleteProject();
      return await service.execute(requireUserId(ctx), input.id);
    }),

  /** Set the active project (for UI state) */
  setActiveProject: protectedProcedure
    .input(SetActiveProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.projectServices.setActiveProject();
      return await service.execute(requireUserId(ctx), input.id);
    }),
});
