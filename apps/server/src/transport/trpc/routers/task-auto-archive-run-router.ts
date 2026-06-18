import { RunTaskAutoArchiveInputSchema } from "@/modules/task-auto-archive";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const taskAutoArchiveRunRouter = router({
  runNow: protectedProcedure
    .input(RunTaskAutoArchiveInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.taskAutoArchive.taskAutoArchive;
      return await service.run(getRequiredUserId(ctx), input ?? {});
    }),
});
