import { ListAgentsInputSchema } from "#runtime/modules/agent";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const agentsQueryRouter = router({
  list: protectedProcedure
    .input(ListAgentsInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.agent.list;
      return await service.execute(getRequiredUserId(ctx), input?.projectId);
    }),
});
