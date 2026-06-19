import { GitProjectInputSchema } from "#runtime/modules/git";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const gitRepositoryRouter = router({
  summary: protectedProcedure
    .input(GitProjectInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.git.repository;
      return await service.getRepositorySummary(getRequiredUserId(ctx), input);
    }),

  changes: protectedProcedure
    .input(GitProjectInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.git.repository;
      return await service.getChanges(getRequiredUserId(ctx), input);
    }),
});
