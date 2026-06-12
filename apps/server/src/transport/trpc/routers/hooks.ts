import {
  ApproveHookRunInputSchema,
  ExportHookRunsInputSchema,
  HooksProjectInputSchema,
  ReviewHookRunInputSchema,
  RunHookBatchInputSchema,
  RunHookInputSchema,
  ToggleHookInputSchema,
  TrustHookInputSchema,
  UpdateHookLifecyclePolicyInputSchema,
  UpdateHookSchedulingPolicyInputSchema,
  UpsertHookInputSchema,
} from "@/modules/hooks";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const hooksRouter = router({
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

  trust: protectedProcedure
    .input(TrustHookInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.hooks.hooks;
      return await service.trust(getRequiredUserId(ctx), input);
    }),

  approveRun: protectedProcedure
    .input(ApproveHookRunInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.hooks.hooks;
      return await service.approveRun(getRequiredUserId(ctx), input);
    }),

  run: protectedProcedure
    .input(RunHookInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.hooks.hooks;
      return await service.run(getRequiredUserId(ctx), input);
    }),

  runBatch: protectedProcedure
    .input(RunHookBatchInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.hooks.hooks;
      return await service.runBatch(getRequiredUserId(ctx), input);
    }),

  reviewRun: protectedProcedure
    .input(ReviewHookRunInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.hooks.hooks;
      return await service.reviewRun(getRequiredUserId(ctx), input);
    }),

  exportRuns: protectedProcedure
    .input(ExportHookRunsInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.hooks.hooks;
      return await service.exportRuns(getRequiredUserId(ctx), input);
    }),
});
