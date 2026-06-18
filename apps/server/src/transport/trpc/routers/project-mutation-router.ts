import {
  CreateProjectInputSchema,
  DeleteProjectInputSchema,
  UpdateProjectInputSchema,
} from "@/modules/project";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const projectMutationRouter = router({
  createProject: protectedProcedure
    .input(CreateProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.project.create;
      return await service.execute(getRequiredUserId(ctx), input);
    }),

  updateProject: protectedProcedure
    .input(UpdateProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.project.update;
      return await service.execute(getRequiredUserId(ctx), input);
    }),

  deleteProject: protectedProcedure
    .input(DeleteProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.project.delete;
      return await service.execute(getRequiredUserId(ctx), input.id);
    }),
});
