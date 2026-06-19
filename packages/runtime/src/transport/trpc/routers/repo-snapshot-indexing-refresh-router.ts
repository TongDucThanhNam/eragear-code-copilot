import { RefreshRepoSnapshotIndexInputSchema } from "#runtime/modules/repo-snapshot-indexing";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const repoSnapshotIndexingRefreshRouter = router({
  refresh: protectedProcedure
    .input(RefreshRepoSnapshotIndexInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.repoSnapshotIndexing.repoSnapshotIndexing;
      return await service.refresh(getRequiredUserId(ctx), input ?? {});
    }),
});
