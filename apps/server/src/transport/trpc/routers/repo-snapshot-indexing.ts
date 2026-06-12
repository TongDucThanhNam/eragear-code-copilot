import {
  RefreshRepoSnapshotIndexInputSchema,
  RepoSnapshotIndexingProjectInputSchema,
  SearchRepoSnapshotIndexInputSchema,
  UpdateRepoSnapshotIndexingSettingsInputSchema,
} from "@/modules/repo-snapshot-indexing";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const repoSnapshotIndexingRouter = router({
  getOverview: protectedProcedure
    .input(RepoSnapshotIndexingProjectInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.repoSnapshotIndexing.repoSnapshotIndexing;
      return await service.getOverview(getRequiredUserId(ctx), input);
    }),

  updateSettings: protectedProcedure
    .input(UpdateRepoSnapshotIndexingSettingsInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.repoSnapshotIndexing.repoSnapshotIndexing;
      return await service.updateSettings(getRequiredUserId(ctx), input);
    }),

  refresh: protectedProcedure
    .input(RefreshRepoSnapshotIndexInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.repoSnapshotIndexing.repoSnapshotIndexing;
      return await service.refresh(getRequiredUserId(ctx), input ?? {});
    }),

  search: protectedProcedure
    .input(SearchRepoSnapshotIndexInputSchema)
    .query(async ({ input, ctx }) => {
      const service = ctx.useCases.repoSnapshotIndexing.repoSnapshotIndexing;
      return await service.search(getRequiredUserId(ctx), input);
    }),
});
