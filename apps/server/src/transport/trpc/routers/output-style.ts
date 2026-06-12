import { UpdateOutputStyleSettingsInputSchema } from "@/modules/output-style";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const outputStyleRouter = router({
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.useCases.outputStyle.outputStyle.getSettings(
      getRequiredUserId(ctx)
    );
  }),

  updateSettings: protectedProcedure
    .input(UpdateOutputStyleSettingsInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.useCases.outputStyle.outputStyle.updateSettings(
        getRequiredUserId(ctx),
        input
      );
    }),
});
