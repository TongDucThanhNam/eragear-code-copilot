import { protectedProcedure, router } from "../base";
import {
  ExportAcpActivityRequestSchema,
  ReplayAcpActivityRequestSchema,
  RetryAcpActivityStreamRequestSchema,
} from "./settings-acp-activity-router-data";
import { resolveSettingsLocalAde } from "./settings-local-ade-resolver";

export const settingsAcpActivityDiagnosticsRouter = router({
  /** Export a redacted ACP activity trace for local debugging. */
  exportAcpActivity: protectedProcedure
    .input(ExportAcpActivityRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.exportAcpActivity(userId, input ?? {})
      )
    ),

  /** Retry the local ACP activity capture/diagnostics snapshot without replaying protocol calls. */
  retryAcpActivityStream: protectedProcedure
    .input(RetryAcpActivityStreamRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.retryAcpActivityStream(userId, input ?? {})
      )
    ),

  /** Build a redacted chronological ACP activity replay for local debugging. */
  replayAcpActivity: protectedProcedure
    .input(ReplayAcpActivityRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.replayAcpActivity(userId, input ?? {})
      )
    ),
});
