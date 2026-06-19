import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const oauthRouter = router({
  getProviders: protectedProcedure.query(({ ctx }) => {
    return ctx.useCases.oauth.oauth.getProviders(getRequiredUserId(ctx));
  }),

  getActiveProvider: protectedProcedure.query(({ ctx }) => {
    return ctx.useCases.oauth.oauth.getActiveProvider(getRequiredUserId(ctx));
  }),

  restoreCachedSession: protectedProcedure.mutation(({ ctx }) => {
    return ctx.useCases.oauth.oauth.restoreCachedSession(
      getRequiredUserId(ctx)
    );
  }),
});
