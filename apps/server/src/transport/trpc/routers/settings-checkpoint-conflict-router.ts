import { protectedProcedure, router } from "../base";
import {
  ResolveCheckpointTrackedConflictChoiceRequestSchema,
  ResolveCheckpointTrackedConflictHunksRequestSchema,
  ResolveCheckpointTrackedConflictsRequestSchema,
  ShelveCheckpointConflictsRequestSchema,
} from "./settings-checkpoint-router-data";
import { resolveSettingsLocalAde } from "./settings-local-ade-resolver";

export const settingsCheckpointConflictRouter = router({
  /** Move unexpected untracked checkpoint restore blockers into a local shelf. */
  shelveCheckpointConflicts: protectedProcedure
    .input(ShelveCheckpointConflictsRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.shelveCheckpointConflicts(userId, input)
      )
    ),

  /** Reset selected tracked patch conflicts after creating a safety checkpoint. */
  resolveCheckpointTrackedConflicts: protectedProcedure
    .input(ResolveCheckpointTrackedConflictsRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.resolveCheckpointTrackedConflicts(userId, input)
      )
    ),

  /** Resolve tracked patch conflicts with an explicit restore/current choice. */
  resolveCheckpointTrackedConflictChoice: protectedProcedure
    .input(ResolveCheckpointTrackedConflictChoiceRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.resolveCheckpointTrackedConflictChoice(userId, input)
      )
    ),

  /** Resolve tracked checkpoint conflicts by restoring selected hunks and keeping the rest. */
  resolveCheckpointTrackedConflictHunks: protectedProcedure
    .input(ResolveCheckpointTrackedConflictHunksRequestSchema)
    .mutation(
      resolveSettingsLocalAde((service, userId, input) =>
        service.resolveCheckpointTrackedConflictHunks(userId, input)
      )
    ),
});
