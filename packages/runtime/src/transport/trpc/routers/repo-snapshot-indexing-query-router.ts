import {
  RepoSnapshotIndexingProjectInputSchema,
  SearchRepoSnapshotIndexInputSchema,
} from "#runtime/modules/repo-snapshot-indexing";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const repoSnapshotIndexingQueryRouter = router({
  getOverview: protectedProcedure
    .input(RepoSnapshotIndexingProjectInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.repoSnapshotIndexing.repoSnapshotIndexing;
      return await service.getOverview(getRequiredUserId(ctx), input);
    }),

  search: protectedProcedure
    .input(SearchRepoSnapshotIndexInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.repoSnapshotIndexing.repoSnapshotIndexing;
      return await service.search(getRequiredUserId(ctx), input);
    }),
});
