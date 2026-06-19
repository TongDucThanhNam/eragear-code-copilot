import { SetActiveProjectInputSchema } from "#runtime/modules/project";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const projectActiveRouter = router({
  setActiveProject: protectedProcedure
    .input(SetActiveProjectInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.project.setActive;
      return await service.execute(getRequiredUserId(ctx), input.id);
    }),
});
