import {
  ApprovePluginRunInputSchema,
  ExportPluginRunsInputSchema,
  ReviewPluginRunInputSchema,
  RunPluginInputSchema,
  TrustPluginInputSchema,
  UpdatePluginPermissionGrantInputSchema,
  UpdatePluginSchedulingPolicyInputSchema,
} from "#runtime/modules/plugins";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const pluginRunRouter = router({
  updateSchedulingPolicy: protectedProcedure
    .input(UpdatePluginSchedulingPolicyInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.updateSchedulingPolicy(
        getRequiredUserId(ctx),
        input
      );
    }),

  trust: protectedProcedure
    .input(TrustPluginInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.trust(getRequiredUserId(ctx), input);
    }),

  updatePermissionGrant: protectedProcedure
    .input(UpdatePluginPermissionGrantInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.updatePermissionGrant(getRequiredUserId(ctx), input);
    }),

  approveRun: protectedProcedure
    .input(ApprovePluginRunInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.approveRun(getRequiredUserId(ctx), input);
    }),

  run: protectedProcedure
    .input(RunPluginInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.run(getRequiredUserId(ctx), input);
    }),

  reviewRun: protectedProcedure
    .input(ReviewPluginRunInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.reviewRun(getRequiredUserId(ctx), input);
    }),

  exportRuns: protectedProcedure
    .input(ExportPluginRunsInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.exportRuns(getRequiredUserId(ctx), input);
    }),
});
