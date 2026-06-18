import {
  ApproveHookRunInputSchema,
  ExportHookRunsInputSchema,
  ReviewHookRunInputSchema,
  RunHookInputSchema,
  TrustHookInputSchema,
} from "@/modules/hooks";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const hooksRunRouter = router({
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
