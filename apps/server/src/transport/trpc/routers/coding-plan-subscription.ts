import {
  CheckCodingPlanFeatureInputSchema,
  OpenBillingPortalInputSchema,
  UpdateCodingPlanSubscriptionInputSchema,
} from "@/modules/coding-plan-subscription";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const codingPlanSubscriptionRouter = router({
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.useCases.codingPlanSubscription.codingPlanSubscription.getStatus(
      getRequiredUserId(ctx)
    );
  }),

  checkFeature: protectedProcedure
    .input(CheckCodingPlanFeatureInputSchema)
    .query(async ({ ctx, input }) => {
      return await ctx.useCases.codingPlanSubscription.codingPlanSubscription.checkFeature(
        getRequiredUserId(ctx),
        input
      );
    }),

  updateSubscription: protectedProcedure
    .input(UpdateCodingPlanSubscriptionInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.useCases.codingPlanSubscription.codingPlanSubscription.updateSubscription(
        getRequiredUserId(ctx),
        input
      );
    }),

  syncBilling: protectedProcedure.mutation(async ({ ctx }) => {
    return await ctx.useCases.codingPlanSubscription.codingPlanSubscription.syncBilling(
      getRequiredUserId(ctx)
    );
  }),

  openBillingPortal: protectedProcedure
    .input(OpenBillingPortalInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await ctx.useCases.codingPlanSubscription.codingPlanSubscription.openBillingPortal(
        getRequiredUserId(ctx),
        input
      );
    }),
});
