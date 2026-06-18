import { protectedProcedure, router } from "../base";
import {
  DeleteAcpReplayPresetRequestSchema,
  SaveAcpReplayPresetRequestSchema,
} from "./settings-acp-activity-router-data";
import { resolveSettingsLocalAde } from "./settings-local-ade-resolver";

export const settingsAcpActivityPresetRouter = router({
  /** Save a project-local ACP replay filter preset for repeated debugging. */
  saveAcpReplayPreset: protectedProcedure
    .input(SaveAcpReplayPresetRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.saveAcpReplayPreset(userId, input)
      )
    ),

  /** Delete a project-local ACP replay filter preset. */
  deleteAcpReplayPreset: protectedProcedure
    .input(DeleteAcpReplayPresetRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.deleteAcpReplayPreset(userId, input)
      )
    ),
});
