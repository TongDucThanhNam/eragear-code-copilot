import {
  RunTaskAutoArchiveInputSchema,
  UpdateTaskAutoArchiveSettingsInputSchema,
} from "@/modules/task-auto-archive";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const taskAutoArchiveRouter = router({
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const service = ctx.useCases.taskAutoArchive.taskAutoArchive;
    return await service.getStatus(getRequiredUserId(ctx));
  }),

  updateSettings: protectedProcedure
    .input(UpdateTaskAutoArchiveSettingsInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.taskAutoArchive.taskAutoArchive;
      return await service.updateSettings(getRequiredUserId(ctx), input);
    }),

  runNow: protectedProcedure
    .input(RunTaskAutoArchiveInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.taskAutoArchive.taskAutoArchive;
      return await service.run(getRequiredUserId(ctx), input ?? {});
    }),
});
