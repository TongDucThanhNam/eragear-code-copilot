import {
  DeletePluginBatchPresetInputSchema,
  DeletePluginBatchScheduleInputSchema,
  RunDuePluginBatchSchedulesInputSchema,
  RunPluginBatchInputSchema,
  RunPluginBatchPresetInputSchema,
  UpsertPluginBatchPresetInputSchema,
  UpsertPluginBatchScheduleInputSchema,
} from "#runtime/modules/plugins";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const pluginBatchRouter = router({
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
});
