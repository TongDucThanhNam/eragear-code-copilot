import { protectedProcedure, router } from "../base";
import {
  CreateCheckpointRequestSchema,
  PreviewCheckpointRequestSchema,
} from "./settings-checkpoint-router-data";
import { resolveSettingsLocalAde } from "./settings-local-ade-resolver";

export const settingsCheckpointBaseRouter = router({
  /** Capture a project-local Git checkpoint patch for review/change trust. */
  createCheckpoint: protectedProcedure
    .input(CreateCheckpointRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.createCheckpoint(userId, input ?? {})
      )
    ),

  /** Read a checkpoint patch preview without applying it. */
  previewCheckpoint: protectedProcedure
    .input(PreviewCheckpointRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.previewCheckpoint(userId, input)
      )
    ),
});
