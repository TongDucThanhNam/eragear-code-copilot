import { protectedProcedure, router } from "../base";
import { RunHookBatchRequestSchema } from "./settings-local-ade-automation-router-data";
import { resolveSettingsLocalAde } from "./settings-local-ade-resolver";

export const settingsHookBatchRouter = router({
  /** Execute a guarded project-local hook batch queue and persist run summaries. */
  runHookBatch: protectedProcedure
    .input(RunHookBatchRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.runHookBatch(userId, input)
      )
    ),
});
