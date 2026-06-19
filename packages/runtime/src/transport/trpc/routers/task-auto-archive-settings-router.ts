import { UpdateTaskAutoArchiveSettingsInputSchema } from "#runtime/modules/task-auto-archive";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const taskAutoArchiveSettingsRouter = router({
  updateSettings: protectedProcedure
    .input(UpdateTaskAutoArchiveSettingsInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.taskAutoArchive.taskAutoArchive;
      return await service.updateSettings(getRequiredUserId(ctx), input);
    }),
});
