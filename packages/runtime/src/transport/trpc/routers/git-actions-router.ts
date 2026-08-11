import { observable } from "@trpc/server/observable";
import {
  GitBranchDiffInputSchema,
  GitWorkflowActionInputSchema,
  type GitWorkflowProgress,
  GitWorkflowProgressInputSchema,
  GitWorkflowProjectInputSchema,
} from "#runtime/modules/git";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const gitActionsRouter = router({
  actions: router({
    status: protectedProcedure
      .input(GitWorkflowProjectInputSchema)
      .query(async ({ input, ctx }) =>
        ctx.useCases.git.workflow.getStatus(getRequiredUserId(ctx), input)
      ),
    branchDiff: protectedProcedure
      .input(GitBranchDiffInputSchema)
      .query(async ({ input, ctx }) =>
        ctx.useCases.git.workflow.getBranchDiff(getRequiredUserId(ctx), input)
      ),
    run: protectedProcedure
      .input(GitWorkflowActionInputSchema)
      .mutation(async ({ input, ctx }) =>
        ctx.useCases.git.workflow.executeAction(getRequiredUserId(ctx), input)
      ),
    progress: protectedProcedure
      .input(GitWorkflowProgressInputSchema)
      .subscription(({ input, ctx }) =>
        observable<GitWorkflowProgress>((emit) => {
          const unsubscribe = ctx.useCases.git.workflow.subscribeProgress(
            getRequiredUserId(ctx),
            input,
            (event) => {
              emit.next(event);
              if (isTerminalProgress(event)) {
                emit.complete();
              }
            }
          );
          return unsubscribe;
        })
      ),
  }),
});

function isTerminalProgress(event: GitWorkflowProgress): boolean {
  if (event.status === "failed") {
    return true;
  }
  if (event.status !== "completed") {
    return false;
  }
  if (event.action === "commit") {
    return event.stage === "commit";
  }
  if (event.action === "push" || event.action === "commit_push") {
    return event.stage === "push";
  }
  return event.stage === "pull_request";
}
