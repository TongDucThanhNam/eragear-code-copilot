import { protectedProcedure, router } from "../base";
import {
  RestoreCheckpointFilesRequestSchema,
  RestoreCheckpointHunksRequestSchema,
  RestoreCheckpointRequestSchema,
} from "./settings-checkpoint-router-data";
import { resolveSettingsLocalAde } from "./settings-local-ade-resolver";

export const settingsCheckpointRestoreRouter = router({
  /** Restore a checkpoint through guarded reverse-patch checks. */
  restoreCheckpoint: protectedProcedure
    .input(RestoreCheckpointRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.restoreCheckpoint(userId, input)
      )
    ),

  /** Restore selected files from a checkpoint through guarded patch filtering. */
  restoreCheckpointFiles: protectedProcedure
    .input(RestoreCheckpointFilesRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.restoreCheckpointFiles(userId, input)
      )
    ),

  /** Restore selected hunks from a checkpoint through guarded patch filtering. */
  restoreCheckpointHunks: protectedProcedure
    .input(RestoreCheckpointHunksRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.restoreCheckpointHunks(userId, input)
      )
    ),
});
