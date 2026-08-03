import { ScopeResolverInputSchema } from "#runtime/modules/scope-resolution";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const scopeResolutionRouter = router({
  resolve: protectedProcedure
    .input(ScopeResolverInputSchema)
    .query(async ({ input, ctx }) => {
      return await ctx.useCases.scopeResolution.scopeResolver.resolve(
        getRequiredUserId(ctx),
        input
      );
    }),
});
