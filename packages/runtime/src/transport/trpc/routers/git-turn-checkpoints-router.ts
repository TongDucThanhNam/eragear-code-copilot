import {
  GitTurnCheckpointCreateInputSchema,
  GitTurnCheckpointDiffInputSchema,
  GitTurnCheckpointRevertInputSchema,
  GitTurnCheckpointSessionInputSchema,
} from "#runtime/modules/git";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const gitTurnCheckpointsRouter = router({
  turnCheckpoints: router({
    list: protectedProcedure
      .input(GitTurnCheckpointSessionInputSchema)
      .query(async ({ input, ctx }) =>
        ctx.useCases.git.checkpoints.listTurnCheckpoints(
          getRequiredUserId(ctx),
          input
        )
      ),
    create: protectedProcedure
      .input(GitTurnCheckpointCreateInputSchema)
      .mutation(async ({ input, ctx }) =>
        ctx.useCases.git.checkpoints.createTurnCheckpoint(
          getRequiredUserId(ctx),
          input
        )
      ),
    diff: protectedProcedure
      .input(GitTurnCheckpointDiffInputSchema)
      .query(async ({ input, ctx }) =>
        ctx.useCases.git.checkpoints.diffTurnCheckpoints(
          getRequiredUserId(ctx),
          input
        )
      ),
    revert: protectedProcedure
      .input(GitTurnCheckpointRevertInputSchema)
      .mutation(async ({ input, ctx }) =>
        ctx.useCases.git.checkpoints.revertTurnCheckpoint(
          getRequiredUserId(ctx),
          input
        )
      ),
  }),
});
