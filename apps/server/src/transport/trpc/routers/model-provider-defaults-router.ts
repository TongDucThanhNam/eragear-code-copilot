import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const modelProviderDefaultsRouter = router({
  restoreDefaults: protectedProcedure.mutation(async ({ ctx }) => {
    return await ctx.useCases.modelProvider.modelProvider.restoreDefaults(
      getRequiredUserId(ctx)
    );
  }),
});
