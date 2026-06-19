import {
  GitCheckpointCreateInputSchema,
  GitCheckpointListInputSchema,
  GitCheckpointRestoreInputSchema,
} from "#runtime/modules/git";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const gitCheckpointsRouter = router({
  checkpoints: router({
    list: protectedProcedure
      .input(GitCheckpointListInputSchema)
      .query(async ({ input, ctx }) => {
        const service = ctx.useCases.git.checkpoints;
        return await service.listCheckpoints(getRequiredUserId(ctx), input);
      }),

    create: protectedProcedure
      .input(GitCheckpointCreateInputSchema)
      .mutation(async ({ input, ctx }) => {
        const service = ctx.useCases.git.checkpoints;
        return await service.createCheckpoint(getRequiredUserId(ctx), input);
      }),

    restore: protectedProcedure
      .input(GitCheckpointRestoreInputSchema)
      .mutation(async ({ input, ctx }) => {
        const service = ctx.useCases.git.checkpoints;
        return await service.restoreCheckpoint(getRequiredUserId(ctx), input);
      }),
  }),
});
