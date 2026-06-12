import { ContextUsageEstimateInputSchema } from "@/modules/context-usage";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const contextUsageRouter = router({
  estimate: protectedProcedure
    .input(ContextUsageEstimateInputSchema)
    .query(async ({ ctx, input }) => {
      return await ctx.useCases.contextUsage.contextUsage.estimate(
        getRequiredUserId(ctx),
        input
      );
    }),
});
