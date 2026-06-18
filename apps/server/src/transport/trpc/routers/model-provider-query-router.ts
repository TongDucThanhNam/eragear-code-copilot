import {
  GetModelProviderInputSchema,
  ListModelProvidersInputSchema,
} from "@/modules/model-provider";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const modelProviderQueryRouter = router({
  list: protectedProcedure
    .input(ListModelProvidersInputSchema)
    .query(async ({ ctx, input }) => {
      return await ctx.useCases.modelProvider.modelProvider.list(
        getRequiredUserId(ctx),
        input
      );
    }),

  get: protectedProcedure
    .input(GetModelProviderInputSchema)
    .query(async ({ ctx, input }) => {
      return await ctx.useCases.modelProvider.modelProvider.get(
        getRequiredUserId(ctx),
        input
      );
    }),
});
