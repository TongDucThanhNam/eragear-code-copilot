import {
  GetUsageStatsSummaryInputSchema,
  UpdateUsageTelemetryInputSchema,
} from "#runtime/modules/usage-stats";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const usageStatsRouter = router({
  getSummary: protectedProcedure
    .input(GetUsageStatsSummaryInputSchema)
    .query(async ({ ctx, input }) => {
      return await ctx.useCases.usageStats.usageStats.getSummary(
        getRequiredUserId(ctx),
        input
      );
    }),

  updateTelemetry: protectedProcedure
    .input(UpdateUsageTelemetryInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.useCases.usageStats.usageStats.updateTelemetry(
        getRequiredUserId(ctx),
        input
      );
    }),
});
