import { ListSubagentInvocationsInputSchema } from "@/modules/session";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const subagentsRouter = router({
  list: protectedProcedure
    .input(ListSubagentInvocationsInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.session.subagents;
      return await service.listInvocations(getRequiredUserId(ctx), input);
    }),
});
