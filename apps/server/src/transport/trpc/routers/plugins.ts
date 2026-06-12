import {
  ApprovePluginRunInputSchema,
  DeletePluginBatchPresetInputSchema,
  DeletePluginBatchScheduleInputSchema,
  ExportPluginRunsInputSchema,
  InstallPluginPackageInputSchema,
  InstallPluginRegistryPackageInputSchema,
  PluginProjectInputSchema,
  RefreshPluginRegistryInputSchema,
  RestorePluginRegistrySignerInputSchema,
  RevalidatePluginPackageInputSchema,
  ReviewPluginRunInputSchema,
  RevokePluginRegistrySignerInputSchema,
  RevokePluginRegistryTrustInputSchema,
  RunDuePluginBatchSchedulesInputSchema,
  RunPluginBatchInputSchema,
  RunPluginBatchPresetInputSchema,
  RunPluginInputSchema,
  TogglePluginInputSchema,
  TrustPluginInputSchema,
  TrustPluginRegistryInputSchema,
  UpdatePluginPermissionGrantInputSchema,
  UpdatePluginSchedulingPolicyInputSchema,
  UpsertPluginBatchPresetInputSchema,
  UpsertPluginBatchScheduleInputSchema,
  UpsertPluginInputSchema,
  UpsertPluginRegistryInputSchema,
} from "@/modules/plugins";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const pluginsRouter = router({
  getOverview: protectedProcedure
    .input(PluginProjectInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.getOverview(getRequiredUserId(ctx), input);
    }),

  getSdkManifest: protectedProcedure.query(({ ctx }) => {
    const service = ctx.useCases.plugins.plugins;
    return service.getSdkManifest();
  }),

  upsert: protectedProcedure
    .input(UpsertPluginInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.upsert(getRequiredUserId(ctx), input);
    }),

  installPackage: protectedProcedure
    .input(InstallPluginPackageInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.installPackage(getRequiredUserId(ctx), input);
    }),

  revalidatePackage: protectedProcedure
    .input(RevalidatePluginPackageInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.revalidatePackage(getRequiredUserId(ctx), input);
    }),

  upsertRegistry: protectedProcedure
    .input(UpsertPluginRegistryInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.upsertRegistry(getRequiredUserId(ctx), input);
    }),

  trustRegistry: protectedProcedure
    .input(TrustPluginRegistryInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.trustRegistry(getRequiredUserId(ctx), input);
    }),

  revokeRegistryTrust: protectedProcedure
    .input(RevokePluginRegistryTrustInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.revokeRegistryTrust(getRequiredUserId(ctx), input);
    }),

  revokeRegistrySigner: protectedProcedure
    .input(RevokePluginRegistrySignerInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.revokeRegistrySigner(getRequiredUserId(ctx), input);
    }),

  restoreRegistrySigner: protectedProcedure
    .input(RestorePluginRegistrySignerInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.restoreRegistrySigner(getRequiredUserId(ctx), input);
    }),

  refreshRegistry: protectedProcedure
    .input(RefreshPluginRegistryInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.refreshRegistry(getRequiredUserId(ctx), input);
    }),

  installRegistryPackage: protectedProcedure
    .input(InstallPluginRegistryPackageInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.installRegistryPackage(
        getRequiredUserId(ctx),
        input
      );
    }),

  toggle: protectedProcedure
    .input(TogglePluginInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.toggle(getRequiredUserId(ctx), input);
    }),

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

  runBatch: protectedProcedure
    .input(RunPluginBatchInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.runBatch(getRequiredUserId(ctx), input);
    }),

  upsertBatchPreset: protectedProcedure
    .input(UpsertPluginBatchPresetInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.upsertBatchPreset(getRequiredUserId(ctx), input);
    }),

  deleteBatchPreset: protectedProcedure
    .input(DeletePluginBatchPresetInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.deleteBatchPreset(getRequiredUserId(ctx), input);
    }),

  runBatchPreset: protectedProcedure
    .input(RunPluginBatchPresetInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.runBatchPreset(getRequiredUserId(ctx), input);
    }),

  upsertBatchSchedule: protectedProcedure
    .input(UpsertPluginBatchScheduleInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.upsertBatchSchedule(getRequiredUserId(ctx), input);
    }),

  deleteBatchSchedule: protectedProcedure
    .input(DeletePluginBatchScheduleInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.deleteBatchSchedule(getRequiredUserId(ctx), input);
    }),

  runDueBatchSchedules: protectedProcedure
    .input(RunDuePluginBatchSchedulesInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.plugins.plugins;
      return await service.runDueBatchSchedules(getRequiredUserId(ctx), input);
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
