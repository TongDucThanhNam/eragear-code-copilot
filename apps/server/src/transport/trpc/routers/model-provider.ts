import {
  DeleteModelProviderInputSchema,
  GetModelProviderInputSchema,
  ListModelProvidersInputSchema,
  UpsertModelProviderInputSchema,
} from "@/modules/model-provider";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const modelProviderRouter = router({
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

  restoreDefaults: protectedProcedure.mutation(async ({ ctx }) => {
    return await ctx.useCases.modelProvider.modelProvider.restoreDefaults(
      getRequiredUserId(ctx)
    );
  }),
});
