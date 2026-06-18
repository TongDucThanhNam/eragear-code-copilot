import {
  HooksProjectInputSchema,
  ToggleHookInputSchema,
  UpdateHookLifecyclePolicyInputSchema,
  UpdateHookSchedulingPolicyInputSchema,
  UpsertHookInputSchema,
} from "@/modules/hooks";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const hooksBaseRouter = router({
  list: protectedProcedure
    .input(HooksProjectInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.hooks.hooks;
      return await service.list(getRequiredUserId(ctx), input);
    }),

  upsert: protectedProcedure
    .input(UpsertHookInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.hooks.hooks;
      return await service.upsert(getRequiredUserId(ctx), input);
    }),

  toggle: protectedProcedure
    .input(ToggleHookInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.hooks.hooks;
      return await service.toggle(getRequiredUserId(ctx), input);
    }),

  updateLifecyclePolicy: protectedProcedure
    .input(UpdateHookLifecyclePolicyInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.hooks.hooks;
      return await service.updateLifecyclePolicy(getRequiredUserId(ctx), input);
    }),

  updateSchedulingPolicy: protectedProcedure
    .input(UpdateHookSchedulingPolicyInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.hooks.hooks;
      return await service.updateSchedulingPolicy(
        getRequiredUserId(ctx),
        input
      );
    }),
});
