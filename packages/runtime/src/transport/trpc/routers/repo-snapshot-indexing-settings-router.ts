import { UpdateRepoSnapshotIndexingSettingsInputSchema } from "#runtime/modules/repo-snapshot-indexing";
import { getRequiredUserId } from "../auth-helpers";
import { protectedProcedure, router } from "../base";

export const repoSnapshotIndexingSettingsRouter = router({
  updateSettings: protectedProcedure
    .input(UpdateRepoSnapshotIndexingSettingsInputSchema)
    .mutation(async ({ input, ctx }) => {
      const service = ctx.useCases.repoSnapshotIndexing.repoSnapshotIndexing;
      return await service.updateSettings(getRequiredUserId(ctx), input);
    }),
});
