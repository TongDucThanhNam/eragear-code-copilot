import { RunHookBatchInputSchema } from "#runtime/modules/hooks";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const hooksBatchRouter = router({
  runBatch: protectedProcedure
    .input(RunHookBatchInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.hooks.hooks;
      return await service.runBatch(getRequiredUserId(ctx), input);
    }),
});
