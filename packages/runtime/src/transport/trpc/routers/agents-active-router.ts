import { SetActiveAgentInputSchema } from "#runtime/modules/agent";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const agentsActiveRouter = router({
  setActive: protectedProcedure
    .input(SetActiveAgentInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.agent.setActive;
      return await service.execute(getRequiredUserId(ctx), input.id);
    }),
});
