import {
  CreateAgentInputSchema,
  DeleteAgentInputSchema,
  UpdateAgentInputSchema,
} from "#runtime/modules/agent";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const agentsMutationRouter = router({
  create: protectedProcedure
    .input(CreateAgentInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.agent.create;
      return await service.execute(getRequiredUserId(ctx), input);
    }),

  update: protectedProcedure
    .input(UpdateAgentInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.agent.update;
      return await service.execute(getRequiredUserId(ctx), input);
    }),

  delete: protectedProcedure
    .input(DeleteAgentInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.agent.delete;
      return await service.execute(getRequiredUserId(ctx), input.id);
    }),
});
