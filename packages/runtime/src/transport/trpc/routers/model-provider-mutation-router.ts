import {
  DeleteModelProviderInputSchema,
  UpsertModelProviderInputSchema,
} from "#runtime/modules/model-provider";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const modelProviderMutationRouter = router({
  upsert: protectedProcedure
    .input(UpsertModelProviderInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.useCases.modelProvider.modelProvider.upsert(
        getRequiredUserId(ctx),
        input
      );
    }),

  delete: protectedProcedure
    .input(DeleteModelProviderInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.useCases.modelProvider.modelProvider.delete(
        getRequiredUserId(ctx),
        input
      );
    }),
});
