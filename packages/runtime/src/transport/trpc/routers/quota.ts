import {
  ListProviderQuotasInputSchema,
  RefreshProviderQuotaInputSchema,
} from "#runtime/modules/quota";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const quotaRouter = router({
  list: protectedProcedure
    .input(ListProviderQuotasInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.quota.provider;
      return await service.list(getRequiredUserId(ctx), input);
    }),

  refresh: protectedProcedure
    .input(RefreshProviderQuotaInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.quota.provider;
      return await service.refresh(getRequiredUserId(ctx), input);
    }),
});
