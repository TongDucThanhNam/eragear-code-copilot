import { protectedProcedure, router } from "../base";
import { resolveSettingsLocalAde } from "./settings-local-ade-resolver";
import {
  ApprovePluginRunRequestSchema,
  ExportPluginRunsRequestSchema,
  ReviewPluginRunRequestSchema,
  RunPluginRequestSchema,
  TrustPluginRequestSchema,
  UpdatePluginPermissionGrantRequestSchema,
  UpdatePluginSchedulingPolicyRequestSchema,
} from "./settings-plugin-router-data";

export const settingsPluginRunRouter = router({
  /** Update project-local plugin execution scheduling and parallel limits. */
  updatePluginSchedulingPolicy: protectedProcedure
    .input(UpdatePluginSchedulingPolicyRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.updatePluginSchedulingPolicy(userId, input)
      )
    ),

  /** Trust the current project-local plugin command fingerprint before execution. */
  trustPlugin: protectedProcedure
    .input(TrustPluginRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.trustPlugin(userId, input)
      )
    ),

  /** Grant or revoke the current project-local plugin permission fingerprint. */
  updatePluginPermissionGrant: protectedProcedure
    .input(UpdatePluginPermissionGrantRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.updatePluginPermissionGrant(userId, input)
      )
    ),

  /** Approve the current project-local plugin manual-run operation once. */
  approvePluginRun: protectedProcedure
    .input(ApprovePluginRunRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.approvePluginRun(userId, input)
      )
    ),

  /** Execute a project-local plugin and persist the redacted run result. */
  runPlugin: protectedProcedure
    .input(RunPluginRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.runPlugin(userId, input)
      )
    ),

  /** Mark or reopen a persisted project-local plugin run audit entry. */
  reviewPluginRun: protectedProcedure
    .input(ReviewPluginRunRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.reviewPluginRun(userId, input)
      )
    ),

  /** Export a redacted project-local plugin run audit artifact. */
  exportPluginRuns: protectedProcedure
    .input(ExportPluginRunsRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.exportPluginRuns(userId, input ?? {})
      )
    ),
});
