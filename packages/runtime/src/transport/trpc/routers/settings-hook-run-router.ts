import { protectedProcedure, router } from "../base";
import {
  ApproveHookRunRequestSchema,
  ExportHookRunsRequestSchema,
  ReviewHookRunRequestSchema,
  RunHookRequestSchema,
  TrustHookRequestSchema,
} from "./settings-local-ade-automation-router-data";
import { resolveSettingsLocalAde } from "./settings-local-ade-resolver";

export const settingsHookRunRouter = router({
  /** Trust the current project-local hook command fingerprint before execution. */
  trustHook: protectedProcedure
    .input(TrustHookRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.trustHook(userId, input)
      )
    ),

  /** Approve the current project-local hook manual-run operation before spawn. */
  approveHookRun: protectedProcedure
    .input(ApproveHookRunRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.approveHookRun(userId, input)
      )
    ),

  /** Execute a project-local manual hook and persist the redacted run result. */
  runHook: protectedProcedure
    .input(RunHookRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.runHook(userId, input)
      )
    ),

  /** Mark or reopen a persisted project-local hook run audit entry. */
  reviewHookRun: protectedProcedure
    .input(ReviewHookRunRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.reviewHookRun(userId, input)
      )
    ),

  /** Export a redacted project-local hook run audit artifact. */
  exportHookRuns: protectedProcedure
    .input(ExportHookRunsRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.exportHookRuns(userId, input ?? {})
      )
    ),
});
